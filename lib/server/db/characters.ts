import type { CharacterSelection } from "@/lib/character-names";
import { characterNameKey } from "@/lib/character-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { normalizeSha256 } from "@/lib/server/crypto/sha256";
import { HttpError } from "@/lib/server/http/json";

export type WorkCharacterCreditInput = {
  selection: CharacterSelection;
  roleKey: "main" | "supporting" | "cameo" | "mentioned" | "other";
  spoilerLevel: number;
  sortOrder: number | null;
  notes: string | null;
};

export function parseCharacterSelection(value: unknown): CharacterSelection {
  if (!isRecord(value) || (value.kind !== "existing" && value.kind !== "new")) {
    throw new HttpError(400, "角色选择格式不合法");
  }
  const originalName = requiredName(value.originalName, "角色日语名");
  const displayName = requiredName(value.displayName, "角色中文名");
  const portraitBlobSha256 = optionalPortraitHash(value.portraitBlobSha256);
  if (value.kind === "existing") {
    if (!Number.isSafeInteger(value.characterId) || Number(value.characterId) <= 0) {
      throw new HttpError(400, "角色 ID 不合法");
    }
    return {
      kind: "existing",
      characterId: Number(value.characterId),
      originalName,
      displayName,
      portraitBlobSha256,
    };
  }
  return { kind: "new", originalName, displayName, portraitBlobSha256 };
}

export function parseCharacterSelectionsJson(
  value: FormDataEntryValue | null,
): CharacterSelection[] {
  if (typeof value !== "string" || !value.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "角色选择不是有效的 JSON");
  }
  if (!Array.isArray(parsed)) throw new HttpError(400, "角色选择必须是数组");
  return parsed.map(parseCharacterSelection);
}

export async function prepareWorkCharacterStatements(input: {
  database: D1Database;
  workId: number;
  credits: WorkCharacterCreditInput[];
  source: "user" | "admin";
  requirePortrait?: boolean;
}): Promise<D1PreparedStatement[]> {
  const credits = input.credits.map((credit) => ({
    ...credit,
    selection: parseCharacterSelection(credit.selection),
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

  const existingResults = existingCredits.length
    ? await input.database.batch(
        existingCredits.map((credit) => {
          const displayKey = characterNameKey(credit.selection.displayName);
          return input.database
            .prepare(
              `SELECT c.id,c.original_name,c.portrait_blob_sha256,
                      CASE
                        WHEN c.primary_name_key=? THEN c.primary_name
                        ELSE (SELECT ca.name FROM character_aliases ca
                              WHERE ca.character_id=c.id AND ca.language='zh' AND ca.name_key=? LIMIT 1)
                      END AS display_name
               FROM characters c WHERE c.id=? LIMIT 1`,
            )
            .bind(displayKey, displayKey, credit.selection.characterId);
        }),
      )
    : [];
  const existingRows = existingResults.map((result, index) => {
    const row = (result.results?.[0] ?? null) as {
      id: number;
      original_name: string;
      portrait_blob_sha256: string | null;
      display_name: string | null;
    } | null;
    if (!row) {
      throw new HttpError(
        409,
        `角色“${existingCredits[index].selection.originalName}”已不存在，请重新选择`,
      );
    }
    if (!row.display_name) {
      throw new HttpError(
        409,
        `角色“${row.original_name}”不包含中文名称“${existingCredits[index].selection.displayName}”，请重新选择`,
      );
    }
    return row;
  });

  const newResults = newCredits.length
    ? await input.database.batch(
        newCredits.map((credit) => {
          const originalKey = characterNameKey(credit.selection.originalName);
          return input.database
            .prepare(
              `SELECT DISTINCT c.id,c.original_name,c.primary_name,c.portrait_blob_sha256
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
      )
    : [];

  const resolvedNewIds = newResults.map((result, index) => {
    const rows = (result.results ?? []) as Array<{
      id: number;
      original_name: string;
      primary_name: string;
      portrait_blob_sha256: string | null;
    }>;
    if (rows.length > 1) {
      throw new HttpError(
        409,
        `日语名“${newCredits[index].selection.originalName}”对应多个角色，请从已有结果中选择`,
      );
    }
    return rows[0] ?? null;
  });

  const identityKeys = new Set<string>();
  for (const row of existingRows) {
    const key = `id:${row.id}`;
    if (identityKeys.has(key)) throw new HttpError(400, "同一角色不能重复添加");
    identityKeys.add(key);
  }
  resolvedNewIds.forEach((row, index) => {
    const key = row
      ? `id:${row.id}`
      : `new:${characterNameKey(newCredits[index].selection.originalName)}`;
    if (identityKeys.has(key)) throw new HttpError(400, "同一角色不能重复添加");
    identityKeys.add(key);
  });

  const portraitHashes = new Set<string>();
  existingCredits.forEach((credit, index) => {
    const current = existingRows[index].portrait_blob_sha256;
    const incoming = credit.selection.portraitBlobSha256 ?? null;
    if (!current && incoming) portraitHashes.add(incoming);
    if (input.requirePortrait && !current && !incoming) {
      throw new HttpError(400, `角色“${credit.selection.originalName}”需要上传头像`);
    }
  });
  newCredits.forEach((credit, index) => {
    const current = resolvedNewIds[index]?.portrait_blob_sha256 ?? null;
    const incoming = credit.selection.portraitBlobSha256 ?? null;
    if (!current && incoming) portraitHashes.add(incoming);
    if (input.requirePortrait && !current && !incoming) {
      throw new HttpError(400, `角色“${credit.selection.originalName}”需要上传头像`);
    }
  });
  if (portraitHashes.size) {
    const hashes = [...portraitHashes];
    const active = await input.database
      .prepare(
        `SELECT sha256 FROM blobs
         WHERE status='active' AND sha256 IN (${hashes.map(() => "?").join(",")})`,
      )
      .bind(...hashes)
      .all<{ sha256: string }>();
    const activeHashes = new Set((active.results ?? []).map((row) => row.sha256));
    if (hashes.some((hash) => !activeHashes.has(hash))) {
      throw new HttpError(409, "角色头像文件尚未上传完成，请重试");
    }
  }

  const setupStatements: D1PreparedStatement[] = [];
  const relationStatements: D1PreparedStatement[] = [];
  existingCredits.forEach((credit, index) => {
    const row = existingRows[index];
    if (!row.portrait_blob_sha256 && credit.selection.portraitBlobSha256) {
      setupStatements.push(
        input.database
          .prepare(
            `UPDATE characters
             SET portrait_blob_sha256=COALESCE(portrait_blob_sha256,?),updated_at=CURRENT_TIMESTAMP
             WHERE id=?`,
          )
          .bind(credit.selection.portraitBlobSha256, row.id),
      );
    }
    relationStatements.push(
      input.database
        .prepare(
          `INSERT INTO work_characters(
             work_id,character_id,display_name,role_key,spoiler_level,sort_order,notes
           ) VALUES(?,?,?,?,?,?,?)`,
        )
        .bind(
          input.workId,
          row.id,
          row.display_name,
          credit.roleKey,
          credit.spoilerLevel,
          credit.sortOrder,
          credit.notes,
        ),
    );
  });
  newCredits.forEach((credit, index) => {
    const selection = credit.selection;
    const existing = resolvedNewIds[index];
    const originalKey = characterNameKey(selection.originalName);
    const displayKey = characterNameKey(selection.displayName);
    if (existing) {
      if (!existing.portrait_blob_sha256 && selection.portraitBlobSha256) {
        setupStatements.push(
          input.database
            .prepare(
              `UPDATE characters
               SET portrait_blob_sha256=COALESCE(portrait_blob_sha256,?),updated_at=CURRENT_TIMESTAMP
               WHERE id=?`,
            )
            .bind(selection.portraitBlobSha256, existing.id),
        );
      }
      setupStatements.push(
        input.database
          .prepare(
            `INSERT OR IGNORE INTO character_aliases(
               character_id,name,name_key,language,source
             ) SELECT id,?,?,'zh',? FROM characters
               WHERE id=? AND primary_name_key<>?`,
          )
          .bind(
            selection.displayName,
            displayKey,
            input.source,
            existing.id,
            displayKey,
          ),
      );
      relationStatements.push(
        input.database
          .prepare(
            `INSERT INTO work_characters(
               work_id,character_id,display_name,role_key,spoiler_level,sort_order,notes
             ) VALUES(?,?,?,?,?,?,?)`,
          )
          .bind(
            input.workId,
            existing.id,
            selection.displayName,
            credit.roleKey,
            credit.spoilerLevel,
            credit.sortOrder,
            credit.notes,
          ),
      );
      return;
    }
    setupStatements.push(
      input.database
        .prepare(
          `INSERT OR IGNORE INTO characters(
             primary_name,primary_name_key,original_name,original_name_key,portrait_blob_sha256,extra_json
           ) VALUES(?,?,?,?,?,'{}')`,
        )
        .bind(
          selection.displayName,
          displayKey,
          selection.originalName,
          originalKey,
          selection.portraitBlobSha256 ?? null,
        ),
      input.database
        .prepare(
          `UPDATE characters
           SET portrait_blob_sha256=COALESCE(portrait_blob_sha256,?),updated_at=CURRENT_TIMESTAMP
           WHERE original_name_key=?`,
        )
        .bind(selection.portraitBlobSha256 ?? null, originalKey),
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
    relationStatements.push(
      input.database
        .prepare(
          `INSERT INTO work_characters(
             work_id,character_id,display_name,role_key,spoiler_level,sort_order,notes
           ) SELECT ?,id,?,?,?,?,? FROM characters WHERE original_name_key=?`,
        )
        .bind(
          input.workId,
          selection.displayName,
          credit.roleKey,
          credit.spoilerLevel,
          credit.sortOrder,
          credit.notes,
          originalKey,
        ),
    );
  });

  return [
    ...setupStatements,
    input.database.prepare(`DELETE FROM work_characters WHERE work_id=?`).bind(input.workId),
    ...relationStatements,
  ];
}

function requiredName(value: unknown, label: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${label}格式不合法`);
  const normalized = normalizeEntityName(value);
  if (!normalized) throw new HttpError(400, `${label}不能为空`);
  return normalized;
}

function optionalPortraitHash(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "角色头像哈希格式不合法");
  try {
    return normalizeSha256(value);
  } catch {
    throw new HttpError(400, "角色头像哈希格式不合法");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
