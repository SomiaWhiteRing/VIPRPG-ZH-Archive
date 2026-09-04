import type {
  CharacterCreditSelection,
  CharacterPortraitChoice,
  CharacterSelection,
} from "@/lib/character-names";
import { characterNameKey } from "@/lib/character-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { normalizeSha256 } from "@/lib/server/crypto/sha256";
import { HttpError } from "@/lib/server/http/json";

export type WorkCharacterCreditInput = CharacterCreditSelection & {
  roleKey: "main" | "supporting" | "cameo" | "mentioned" | "other";
  spoilerLevel: number;
  sortOrder: number | null;
  notes: string | null;
};

type ResolvedCharacter = {
  id: number;
  original_name: string;
  display_name: string | null;
  has_default_portrait: number;
};

type FaceSheetChoice = {
  id: number;
  blob_sha256: string;
  width_px: number;
  height_px: number;
  library_status: "pending" | "approved" | "rejected";
  created_by_user_id: number | null;
  characterIds: Set<number>;
};

export function parseCharacterSelection(value: unknown): CharacterSelection {
  if (!isRecord(value) || (value.kind !== "existing" && value.kind !== "new")) {
    throw new HttpError(400, "角色选择格式不合法");
  }
  const originalName = requiredName(value.originalName, "角色日语名");
  const displayName = requiredName(value.displayName, "角色中文名");
  if (value.kind === "existing") {
    if (!Number.isSafeInteger(value.characterId) || Number(value.characterId) <= 0) {
      throw new HttpError(400, "角色 ID 不合法");
    }
    return {
      kind: "existing",
      characterId: Number(value.characterId),
      originalName,
      displayName,
    };
  }
  return { kind: "new", originalName, displayName };
}

export function parseCharacterCreditSelection(value: unknown): CharacterCreditSelection {
  if (!isRecord(value)) throw new HttpError(400, "角色关联格式不合法");
  return {
    selection: parseCharacterSelection(value.selection),
    portrait: parsePortraitChoice(value.portrait),
    faceSheetBlobSha256s: parseFaceSheetHashes(value.faceSheetBlobSha256s),
  };
}

export function parseCharacterSelectionsJson(
  value: FormDataEntryValue | null,
): CharacterCreditSelection[] {
  if (typeof value !== "string" || !value.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "角色关联不是有效的 JSON");
  }
  if (!Array.isArray(parsed)) throw new HttpError(400, "角色关联必须是数组");
  return parsed.map(parseCharacterCreditSelection);
}

export async function prepareWorkCharacterStatements(input: {
  database: D1Database;
  workId: number;
  credits: WorkCharacterCreditInput[];
  source: "user" | "admin";
  actorUserId: number;
  requirePortrait?: boolean;
}): Promise<D1PreparedStatement[]> {
  const credits = input.credits.map((credit) => ({
    ...credit,
    selection: parseCharacterSelection(credit.selection),
    portrait: parsePortraitChoice(credit.portrait),
  }));
  const existingCredits = credits.filter(
    (credit): credit is WorkCharacterCreditInput & {
      selection: Extract<CharacterSelection, { kind: "existing" }>;
    } => credit.selection.kind === "existing",
  );
  const newCredits = credits.filter(
    (credit): credit is WorkCharacterCreditInput & {
      selection: Extract<CharacterSelection, { kind: "new" }>;
    } => credit.selection.kind === "new",
  );

  const existingRows = await resolveExistingCharacters(input.database, existingCredits);
  const resolvedNewRows = await resolveNewCharacters(input.database, newCredits);

  const sheets = await loadFaceSheetChoices(
    input.database,
    credits.flatMap((credit) => [
      ...credit.faceSheetBlobSha256s,
      ...(credit.portrait ? [credit.portrait.blobSha256] : []),
    ]),
  );
  const setupStatements: D1PreparedStatement[] = [];
  const relationStatements: D1PreparedStatement[] = [];

  existingCredits.forEach((credit, index) => {
    const character = existingRows[index];
    const sheet = validatePortraitChoice(credit, character, sheets, input);
    validateFaceSheetBindings(credit, character, sheets, input);
    if (input.requirePortrait && !credit.portrait && character.has_default_portrait !== 1) {
      throw new HttpError(400, `角色“${credit.selection.originalName}”需要选择头像`);
    }
    if (credit.portrait && sheet) {
      addPortraitReferenceStatements(
        setupStatements,
        input.database,
        character.id,
        sheet,
        credit.portrait,
        input.actorUserId,
      );
    }
    addFaceSheetBindingStatements(
      setupStatements,
      input.database,
      character.id,
      credit.faceSheetBlobSha256s,
    );
    relationStatements.push(
      insertKnownCharacterRelation(
        input.database,
        input.workId,
        character.id,
        character.display_name as string,
        credit,
      ),
    );
  });

  newCredits.forEach((credit, index) => {
    const selection = credit.selection;
    const existing = resolvedNewRows[index];
    const originalKey = characterNameKey(selection.originalName);
    const displayKey = characterNameKey(selection.displayName);
    const sheet = validatePortraitChoice(credit, existing, sheets, input);
    validateFaceSheetBindings(credit, existing, sheets, input);
    if (input.requirePortrait && !credit.portrait && existing?.has_default_portrait !== 1) {
      throw new HttpError(400, `角色“${selection.originalName}”需要选择头像`);
    }

    if (existing) {
      setupStatements.push(
        input.database
          .prepare(
            `INSERT OR IGNORE INTO character_aliases(
               character_id,name,name_key,language,source
             ) SELECT id,?,?,'zh',? FROM characters
               WHERE id=? AND primary_name_key<>?`,
          )
          .bind(selection.displayName, displayKey, input.source, existing.id, displayKey),
      );
      if (credit.portrait && sheet) {
        addPortraitReferenceStatements(
          setupStatements,
          input.database,
          existing.id,
          sheet,
          credit.portrait,
          input.actorUserId,
        );
      }
      addFaceSheetBindingStatements(
        setupStatements,
        input.database,
        existing.id,
        credit.faceSheetBlobSha256s,
      );
      relationStatements.push(
        insertKnownCharacterRelation(
          input.database,
          input.workId,
          existing.id,
          selection.displayName,
          credit,
        ),
      );
      return;
    }

    setupStatements.push(
      input.database
        .prepare(
          `INSERT OR IGNORE INTO characters(
             primary_name,primary_name_key,original_name,original_name_key,extra_json
           ) VALUES(?,?,?,?,'{}')`,
        )
        .bind(selection.displayName, displayKey, selection.originalName, originalKey),
      input.database
        .prepare(
          `INSERT OR IGNORE INTO character_aliases(
             character_id,name,name_key,language,source
           ) SELECT id,?,?,'zh',? FROM characters
             WHERE original_name_key=? AND primary_name_key<>?`,
        )
        .bind(
          selection.displayName,
          displayKey,
          input.source,
          originalKey,
          displayKey,
        ),
    );
    if (credit.portrait && sheet) {
      addNewCharacterPortraitStatements(
        setupStatements,
        input.database,
        originalKey,
        sheet,
        credit.portrait,
        input.actorUserId,
      );
    }
    addNewCharacterFaceSheetBindingStatements(
      setupStatements,
      input.database,
      originalKey,
      credit.faceSheetBlobSha256s,
    );
    relationStatements.push(
      insertNewCharacterRelation(
        input.database,
        input.workId,
        originalKey,
        selection.displayName,
        credit,
      ),
    );
  });

  return [
    ...setupStatements,
    input.database.prepare(`DELETE FROM work_characters WHERE work_id=?`).bind(input.workId),
    ...relationStatements,
  ];
}

async function resolveExistingCharacters(
  database: D1Database,
  credits: Array<WorkCharacterCreditInput & {
    selection: Extract<CharacterSelection, { kind: "existing" }>;
  }>,
): Promise<ResolvedCharacter[]> {
  if (!credits.length) return [];
  const results = await database.batch(
    credits.map((credit) => {
      const displayKey = characterNameKey(credit.selection.displayName);
      return database
        .prepare(
          `SELECT c.id,c.original_name,
                  CASE
                    WHEN c.primary_name_key=? THEN c.primary_name
                    ELSE (SELECT ca.name FROM character_aliases ca
                          WHERE ca.character_id=c.id AND ca.language='zh' AND ca.name_key=? LIMIT 1)
                  END AS display_name,
                  EXISTS(SELECT 1 FROM character_default_portraits cdp WHERE cdp.character_id=c.id)
                    AS has_default_portrait
           FROM characters c WHERE c.id=? LIMIT 1`,
        )
        .bind(displayKey, displayKey, credit.selection.characterId);
    }),
  );
  return results.map((result, index) => {
    const row = (result.results?.[0] ?? null) as ResolvedCharacter | null;
    if (!row) {
      throw new HttpError(
        409,
        `角色“${credits[index].selection.originalName}”已不存在，请重新选择`,
      );
    }
    if (!row.display_name) {
      throw new HttpError(
        409,
        `角色“${row.original_name}”不包含中文名称“${credits[index].selection.displayName}”，请重新选择`,
      );
    }
    return row;
  });
}

async function resolveNewCharacters(
  database: D1Database,
  credits: Array<WorkCharacterCreditInput & {
    selection: Extract<CharacterSelection, { kind: "new" }>;
  }>,
): Promise<Array<ResolvedCharacter | null>> {
  if (!credits.length) return [];
  const results = await database.batch(
    credits.map((credit) => {
      const originalKey = characterNameKey(credit.selection.originalName);
      return database
        .prepare(
          `SELECT DISTINCT c.id,c.original_name,c.primary_name AS display_name,
                  EXISTS(SELECT 1 FROM character_default_portraits cdp WHERE cdp.character_id=c.id)
                    AS has_default_portrait
           FROM characters c
           WHERE c.original_name_key=?
              OR EXISTS(
                SELECT 1 FROM character_aliases ca
                WHERE ca.character_id=c.id AND ca.language='ja' AND ca.name_key=?
              )
           ORDER BY c.id`,
        )
        .bind(originalKey, originalKey);
    }),
  );
  return results.map((result, index) => {
    const rows = (result.results ?? []) as ResolvedCharacter[];
    if (rows.length > 1) {
      throw new HttpError(
        409,
        `日语名“${credits[index].selection.originalName}”对应多个角色，请从已有结果中选择`,
      );
    }
    return rows[0] ?? null;
  });
}

async function loadFaceSheetChoices(
  database: D1Database,
  rawHashes: string[],
): Promise<Map<string, FaceSheetChoice>> {
  const hashes = [...new Set(rawHashes.map(normalizeSha256))];
  if (!hashes.length) return new Map();
  const rows = await database
    .prepare(
      `SELECT fs.id,fs.blob_sha256,fs.width_px,fs.height_px,fs.library_status,
              fs.created_by_user_id,cfsb.character_id
       FROM face_sheets fs
       LEFT JOIN character_face_sheet_bindings cfsb ON cfsb.face_sheet_id=fs.id
       WHERE fs.blob_sha256 IN (${hashes.map(() => "?").join(",")})`,
    )
    .bind(...hashes)
    .all<{
      id: number;
      blob_sha256: string;
      width_px: number;
      height_px: number;
      library_status: FaceSheetChoice["library_status"];
      created_by_user_id: number | null;
      character_id: number | null;
    }>();
  const sheets = new Map<string, FaceSheetChoice>();
  for (const row of rows.results ?? []) {
    let sheet = sheets.get(row.blob_sha256);
    if (!sheet) {
      sheet = { ...row, characterIds: new Set() };
      sheets.set(row.blob_sha256, sheet);
    }
    if (row.character_id !== null) sheet.characterIds.add(row.character_id);
  }
  if (hashes.some((hash) => !sheets.has(hash))) {
    throw new HttpError(409, "角色头像尚未登记为脸图，请重新上传或重新选择");
  }
  return sheets;
}

function validatePortraitChoice(
  credit: WorkCharacterCreditInput,
  character: ResolvedCharacter | null,
  sheets: Map<string, FaceSheetChoice>,
  input: { source: "user" | "admin"; actorUserId: number },
): FaceSheetChoice | null {
  if (!credit.portrait) return null;
  const sheet = sheets.get(credit.portrait.blobSha256);
  if (!sheet) throw new HttpError(409, "角色头像对应的脸图不存在");
  if (
    credit.portrait.row * 48 >= sheet.height_px ||
    credit.portrait.column * 48 >= sheet.width_px
  ) {
    throw new HttpError(400, "角色头像坐标超出脸图范围");
  }
  if (sheet.library_status === "rejected") {
    throw new HttpError(409, "这张脸图已被拒绝使用，请重新选择");
  }
  if (character && sheet.characterIds.has(character.id)) return sheet;
  const mayBind =
    input.source === "admin" ||
    (sheet.library_status === "pending" && sheet.created_by_user_id === input.actorUserId);
  if (!mayBind) throw new HttpError(409, "这张脸图没有绑定到所选角色");
  return sheet;
}

function validateFaceSheetBindings(
  credit: WorkCharacterCreditInput,
  character: ResolvedCharacter | null,
  sheets: Map<string, FaceSheetChoice>,
  input: { source: "user" | "admin"; actorUserId: number },
): void {
  for (const hash of credit.faceSheetBlobSha256s) {
    const sheet = sheets.get(hash);
    if (!sheet) throw new HttpError(409, "角色素材表尚未登记，请重新上传");
    if (sheet.library_status === "rejected") {
      throw new HttpError(409, "这张角色素材表已被拒绝使用，请重新选择");
    }
    if (character && sheet.characterIds.has(character.id)) continue;
    if (
      input.source !== "admin" &&
      !(sheet.library_status === "pending" && sheet.created_by_user_id === input.actorUserId)
    ) {
      throw new HttpError(409, "这张素材表不能绑定到所选角色");
    }
  }
}

function addPortraitReferenceStatements(
  statements: D1PreparedStatement[],
  database: D1Database,
  characterId: number,
  sheet: FaceSheetChoice,
  portrait: CharacterPortraitChoice,
  actorUserId: number,
): void {
  statements.push(
    database
      .prepare(
        `INSERT OR IGNORE INTO character_face_sheet_bindings(character_id,face_sheet_id)
         VALUES(?,?)`,
      )
      .bind(characterId, sheet.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_portrait_refs(
           character_id,face_sheet_id,cell_row,cell_column,created_by_user_id
         ) VALUES(?,?,?,?,?)`,
      )
      .bind(characterId, sheet.id, portrait.row, portrait.column, actorUserId),
  );
}

function addNewCharacterPortraitStatements(
  statements: D1PreparedStatement[],
  database: D1Database,
  originalKey: string,
  sheet: FaceSheetChoice,
  portrait: CharacterPortraitChoice,
  actorUserId: number,
): void {
  statements.push(
    database
      .prepare(
        `INSERT OR IGNORE INTO character_face_sheet_bindings(character_id,face_sheet_id)
         SELECT id,? FROM characters WHERE original_name_key=?`,
      )
      .bind(sheet.id, originalKey),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_portrait_refs(
           character_id,face_sheet_id,cell_row,cell_column,created_by_user_id
         ) SELECT id,?,?,?,? FROM characters WHERE original_name_key=?`,
      )
      .bind(sheet.id, portrait.row, portrait.column, actorUserId, originalKey),
  );
}

function addFaceSheetBindingStatements(
  statements: D1PreparedStatement[],
  database: D1Database,
  characterId: number,
  hashes: string[],
): void {
  for (const hash of hashes) {
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO character_face_sheet_bindings(character_id,face_sheet_id)
           SELECT ?,id FROM face_sheets WHERE blob_sha256=?`,
        )
        .bind(characterId, hash),
    );
  }
}

function addNewCharacterFaceSheetBindingStatements(
  statements: D1PreparedStatement[],
  database: D1Database,
  originalKey: string,
  hashes: string[],
): void {
  for (const hash of hashes) {
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO character_face_sheet_bindings(character_id,face_sheet_id)
           SELECT c.id,fs.id FROM characters c
           JOIN face_sheets fs ON fs.blob_sha256=?
           WHERE c.original_name_key=?`,
        )
        .bind(hash, originalKey),
    );
  }
}

function insertKnownCharacterRelation(
  database: D1Database,
  workId: number,
  characterId: number,
  displayName: string,
  credit: WorkCharacterCreditInput,
): D1PreparedStatement {
  if (!credit.portrait) {
    return database
      .prepare(
        `INSERT INTO work_characters(
           work_id,character_id,portrait_ref_id,display_name,role_key,spoiler_level,sort_order,notes
         ) VALUES(?,?,NULL,?,?,?,?,?)`,
      )
      .bind(
        workId,
        characterId,
        displayName,
        credit.roleKey,
        credit.spoilerLevel,
        credit.sortOrder,
        credit.notes,
      );
  }
  return database
    .prepare(
      `INSERT INTO work_characters(
         work_id,character_id,portrait_ref_id,display_name,role_key,spoiler_level,sort_order,notes
       ) SELECT ?,?,pr.id,?,?,?,?,?
         FROM face_sheets fs
         JOIN character_portrait_refs pr
           ON pr.face_sheet_id=fs.id AND pr.character_id=?
          AND pr.cell_row=? AND pr.cell_column=?
         WHERE fs.blob_sha256=?`,
    )
    .bind(
      workId,
      characterId,
      displayName,
      credit.roleKey,
      credit.spoilerLevel,
      credit.sortOrder,
      credit.notes,
      characterId,
      credit.portrait.row,
      credit.portrait.column,
      credit.portrait.blobSha256,
    );
}

function insertNewCharacterRelation(
  database: D1Database,
  workId: number,
  originalKey: string,
  displayName: string,
  credit: WorkCharacterCreditInput,
): D1PreparedStatement {
  if (!credit.portrait) {
    return database
      .prepare(
        `INSERT INTO work_characters(
           work_id,character_id,portrait_ref_id,display_name,role_key,spoiler_level,sort_order,notes
         ) SELECT ?,id,NULL,?,?,?,?,? FROM characters WHERE original_name_key=?`,
      )
      .bind(
        workId,
        displayName,
        credit.roleKey,
        credit.spoilerLevel,
        credit.sortOrder,
        credit.notes,
        originalKey,
      );
  }
  return database
    .prepare(
      `INSERT INTO work_characters(
         work_id,character_id,portrait_ref_id,display_name,role_key,spoiler_level,sort_order,notes
       ) SELECT ?,c.id,pr.id,?,?,?,?,?
         FROM characters c
         JOIN face_sheets fs ON fs.blob_sha256=?
         JOIN character_portrait_refs pr
           ON pr.face_sheet_id=fs.id AND pr.character_id=c.id
          AND pr.cell_row=? AND pr.cell_column=?
         WHERE c.original_name_key=?`,
    )
    .bind(
      workId,
      displayName,
      credit.roleKey,
      credit.spoilerLevel,
      credit.sortOrder,
      credit.notes,
      credit.portrait.blobSha256,
      credit.portrait.row,
      credit.portrait.column,
      originalKey,
    );
}

function requiredName(value: unknown, label: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${label}格式不合法`);
  const normalized = normalizeEntityName(value);
  if (!normalized) throw new HttpError(400, `${label}不能为空`);
  return normalized;
}

function parsePortraitChoice(value: unknown): CharacterPortraitChoice | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isRecord(value)) throw new HttpError(400, "角色头像选择格式不合法");
  let blobSha256: string;
  try {
    blobSha256 = normalizeSha256(String(value.blobSha256 ?? ""));
  } catch {
    throw new HttpError(400, "角色头像哈希格式不合法");
  }
  const row = Number(value.row);
  const column = Number(value.column);
  if (!Number.isSafeInteger(row) || row < 0 || !Number.isSafeInteger(column) || column < 0) {
    throw new HttpError(400, "角色头像坐标不合法");
  }
  return { blobSha256, row, column };
}

function parseFaceSheetHashes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, "角色素材表列表格式不合法");
  try {
    return [...new Set(value.map((hash) => normalizeSha256(String(hash))))];
  } catch {
    throw new HttpError(400, "角色素材表哈希格式不合法");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
