import type { CharacterPortraitRow } from "@/app/.server/db/character-portrait-library";
import {
  CHARACTER_PORTRAIT_COLUMNS,
  DEFAULT_CHARACTER_PORTRAIT_JOINS,
  PUBLIC_CHARACTER_PORTRAIT_CONDITION,
  mapCharacterPortrait,
} from "@/app/.server/db/character-portrait-library";
import { getD1 } from "@/app/.server/db/d1";
import { auditedEntityBatch, characterAuditSnapshot, combinedAuditSnapshot, tagAuditSnapshot } from "@/app/.server/db/entity-audit";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { memoizeRequest, type AppRuntime } from "@/app/.server/runtime";
import type {
  CharacterAliasSuggestion,
  CharacterSuggestion,
} from "@/lib/character-names";
import { characterNameKey } from "@/lib/character-names";
import type {
  AdminCharacterEdit,
  AdminTagEdit,
  CharacterAliasMergeCandidate,
  PublicCharacterIndexEntry,
  PublicCharacterSummary,
  PublicTagSummary,
} from "@/lib/dto/db/taxonomy-library";
import { normalizeEntityName } from "@/lib/entity-name";
import { HttpError } from "@/lib/http";

export class CharacterAliasMergeConflictError extends HttpError {
  constructor(
    public readonly aliases: string[],
    public readonly currentCharacterId: number,
    public readonly candidate: CharacterAliasMergeCandidate,
  ) {
    super(
      409,
      `日文别名${formatQuotedNames(aliases)}已归属于角色 #${candidate.id}“${candidate.originalName} · ${candidate.primaryName}”。可以修改别名，或确认将该角色合并到当前角色。`,
      "character_alias_merge_available",
    );
    this.name = "CharacterAliasMergeConflictError";
  }
}

type CharacterRow = CharacterPortraitRow & {
  id: number;
  primary_name: string;
  original_name: string;
  description: string | null;
  extra_json: string;
  work_count: number;
  updated_at: string;
};
type TagRow = {
  name: string;
  namespace: string;
  description: string | null;
  work_count: number;
  updated_at: string;
};

export async function listPublicCharacters(
  runtime: AppRuntime,
  input: { query?: string; limit?: number } = {},
): Promise<PublicCharacterSummary[]> {
  const binds: Array<string | number> = [];
  // Character identities are public even when they have no published works.
  const where: string[] = [];
  if (input.query?.trim()) {
    const q = input.query.trim();
    where.push(
      "(instr(lower(ch.primary_name),lower(?)) > 0 OR instr(lower(ch.original_name),lower(?)) > 0 OR EXISTS(SELECT 1 FROM character_aliases ca WHERE ca.character_id=ch.id AND instr(lower(ca.name),lower(?)) > 0))",
    );
    binds.push(q, q, q);
  }
  const rows = await getD1(runtime)
    .prepare(
      `${characterSql(true)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY work_count DESC,ch.primary_name ASC LIMIT ?`,
    )
    .bind(...binds, limitValue(input.limit ?? 120, 300))
    .all<CharacterRow>();
  return (rows.results ?? []).map(mapCharacter);
}

export async function searchPublicCharacters(
  runtime: AppRuntime,
  input: { query?: string; page?: number; pageSize?: number } = {},
) {
  const pageSize = limitValue(input.pageSize ?? 20, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const binds: string[] = [];
  const where: string[] = [];
  if (input.query?.trim()) {
    const q = input.query.trim();
    where.push(
      "(instr(lower(ch.primary_name),lower(?)) > 0 OR instr(lower(ch.original_name),lower(?)) > 0 OR EXISTS(SELECT 1 FROM character_aliases ca WHERE ca.character_id=ch.id AND instr(lower(ca.name),lower(?)) > 0))",
    );
    binds.push(q, q, q);
  }
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const database = getD1(runtime);
  const [rows, count] = await database.batch([
    database
      .prepare(
        `${characterSql(true)}${clause} ORDER BY work_count DESC,ch.primary_name ASC,ch.id ASC LIMIT ? OFFSET ?`,
      )
      .bind(...binds, pageSize, (page - 1) * pageSize),
    database
      .prepare(`SELECT COUNT(*) AS count FROM characters ch${clause}`)
      .bind(...binds),
  ]);
  return {
    items: (rows.results ?? []).map((row) => mapCharacter(row as CharacterRow)),
    total: Number(
      (count.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    page,
    pageSize,
  };
}
export async function getPublicCharacterSummary(
  runtime: AppRuntime,
  id: number,
): Promise<PublicCharacterSummary | null> {
  return getCharacter(runtime, id, false);
}

// Character identities are public taxonomy. Counts include only published works.
export function listPublicCharacterIndex(
  runtime: AppRuntime,
): Promise<PublicCharacterIndexEntry[]> {
  return memoizeRequest(runtime, "public-character-index", () =>
    readPublicCharacterIndex(runtime),
  );
}

async function readPublicCharacterIndex(
  runtime: AppRuntime,
): Promise<PublicCharacterIndexEntry[]> {
  const database = getD1(runtime);
  const [characters, aliases] = await database.batch([
    database.prepare(
      `${characterSql(true, true, "index")} ORDER BY ch.primary_name,ch.id`,
    ),
    database.prepare(
      "SELECT character_id,name,language FROM character_aliases ORDER BY character_id,language,name",
    ),
  ]);
  const byCharacter = new Map<number, CharacterAliasSuggestion[]>();
  for (const row of (aliases.results ?? []) as Array<{
    character_id: number;
    name: string;
    language: "ja" | "zh";
  }>) {
    const names = byCharacter.get(row.character_id) ?? [];
    names.push({ name: row.name, language: row.language });
    byCharacter.set(row.character_id, names);
  }
  return ((characters.results ?? []) as CharacterRow[]).map((row) => ({
    id: row.id,
    primaryName: row.primary_name,
    originalName: row.original_name,
    defaultPortrait: mapCharacterPortrait(row),
    workCount: row.work_count,
    aliases: byCharacter.get(row.id) ?? [],
  }));
}
export async function listCharactersForAdmin(
  runtime: AppRuntime,
  limit = 1000,
): Promise<PublicCharacterSummary[]> {
  const rows = await getD1(runtime)
    .prepare(
      `${characterSql()} ORDER BY ch.updated_at DESC,ch.primary_name ASC LIMIT ?`,
    )
    .bind(limitValue(limit, 2000))
    .all<CharacterRow>();
  return (rows.results ?? []).map(mapCharacter);
}

export async function listCharacterSuggestions(
  runtime: AppRuntime,
): Promise<CharacterSuggestion[]> {
  // Names and portraits are small; the picker loads sheets for selected characters.
  const characters = await listPublicCharacterIndex(runtime);
  return [...characters].sort((a, b) => b.workCount - a.workCount).map((character) => ({
    id: character.id,
    originalName: character.originalName,
    primaryName: character.primaryName,
    defaultPortrait: character.defaultPortrait,
    faceSheets: [],
    aliases: character.aliases,
    workCount: character.workCount,
  }));
}

export async function listPublicCharacterFaceSheets(
  runtime: AppRuntime,
  characterId: number,
) {
  const result = await getD1(runtime).prepare(`
    SELECT fs.id,fs.blob_sha256 AS blobSha256,fs.width_px AS width,fs.height_px AS height,
      fs.source_page_title AS sourcePageTitle,fs.source_section_title AS sourceSectionTitle
    FROM character_face_sheet_bindings binding
    CROSS JOIN face_sheets fs ON fs.id=binding.face_sheet_id
    CROSS JOIN blobs b ON b.sha256=fs.blob_sha256
    WHERE binding.character_id=? AND fs.library_status='approved'
      AND b.status='active' AND b.public_at IS NOT NULL AND b.content_type_hint LIKE 'image/%'
    ORDER BY fs.source_order IS NULL,fs.source_order,fs.id`)
    .bind(characterId).all<import('@/lib/character-names').CharacterFaceSheet>();
  return result.results;
}
export async function searchCharactersForAdmin(
  runtime: AppRuntime,
  input: {
    query?: string;
    sort?: "default" | "name" | "works";
    page?: number;
    pageSize?: number;
  },
): Promise<{
  items: PublicCharacterSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const pageSize = limitValue(input.pageSize ?? 50, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const binds: Array<string | number> = [];
  const clauses: string[] = [];
  if (input.query?.trim()) {
    const value = `%${input.query.trim()}%`;
    clauses.push(
      "(ch.primary_name LIKE ? OR ch.original_name LIKE ? OR EXISTS(SELECT 1 FROM character_aliases ca WHERE ca.character_id=ch.id AND ca.name LIKE ?))",
    );
    binds.push(value, value, value);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order =
    input.sort === "name"
      ? "ch.primary_name ASC,ch.id DESC"
      : input.sort === "works"
        ? "work_count DESC,ch.id DESC"
        : "ch.updated_at DESC,ch.id DESC";
  const database = getD1(runtime);
  const [rowsResult, countResult] = await database.batch([
    database
      .prepare(`${characterSql()} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, (page - 1) * pageSize),
    database
      .prepare(`SELECT COUNT(*) AS count FROM characters ch ${where}`)
      .bind(...binds),
  ]);
  return {
    items: ((rowsResult.results ?? []) as CharacterRow[]).map(mapCharacter),
    total: Number(
      (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    page,
    pageSize,
  };
}
export async function getCharacterForAdminEdit(
  runtime: AppRuntime,
  id: number,
): Promise<AdminCharacterEdit | null> {
  const database = getD1(runtime);
  const [characterResult, aliasesResult] = await database.batch([
    database.prepare(`${characterSql()} WHERE ch.id=? LIMIT 1`).bind(id),
    database
      .prepare(
        `SELECT name,language FROM character_aliases
       WHERE character_id=? ORDER BY language,name`,
      )
      .bind(id),
  ]);
  const row = (characterResult.results?.[0] ?? null) as CharacterRow | null;
  return row
    ? {
        ...mapCharacter(row),
        aliases: (aliasesResult.results ?? []).map((alias) => ({
          name: String((alias as { name: string }).name),
          language: (alias as { language: "ja" | "zh" }).language,
        })),
        extra: parseExtra(row.extra_json),
      }
    : null;
}
export async function createCharacterForAdmin(
  runtime: AppRuntime,
  input: {
    primaryName: string;
    originalName: string;
  },
  actor: ArchiveUser,
): Promise<{ character: AdminCharacterEdit; created: boolean }> {
  const primaryName = normalizeEntityName(input.primaryName);
  if (!primaryName)
    throw new HttpError(400, "角色中文名不能为空。", "character_name_required");
  const originalName = normalizeEntityName(input.originalName);
  if (!originalName)
    throw new HttpError(
      400,
      "角色日语名不能为空。",
      "character_original_name_required",
    );

  const database = getD1(runtime);
  const originalKey = characterNameKey(originalName);
  const primaryKey = characterNameKey(primaryName);
  const existingRows = await database
    .prepare(
      `SELECT DISTINCT c.id
     FROM characters c
     WHERE c.original_name_key=?
        OR EXISTS(
          SELECT 1 FROM character_aliases ca
          WHERE ca.character_id=c.id AND ca.language='ja' AND ca.name_key=?
        )
     ORDER BY c.id`,
    )
    .bind(originalKey, originalKey)
    .all<{ id: number }>();
  const existingIds = (existingRows.results ?? []).map((row) => row.id);
  if (existingIds.length > 1) {
    throw new HttpError(
      409,
      `日语名“${originalName}”对应多个角色，请先在角色维护页合并重复记录。`,
      "character_name_multiple_matches",
    );
  }

  const existingId = existingIds[0] ?? null;
  if (existingId !== null) {
    const character = await getCharacterForAdminEdit(runtime, existingId);
    if (!character) throw new Error("已有角色不可读取");
    return { character, created: false };
  }

  try {
    const snapshot = characterAuditSnapshot(0);
    snapshot.sql = snapshot.sql.replace("WHERE id=?", "WHERE original_name_key=?");
    snapshot.binds = [originalKey];
    await auditedEntityBatch(database, [database
      .prepare(
        `INSERT INTO characters(
         primary_name,primary_name_key,original_name,original_name_key,extra_json
       ) VALUES(?,?,?,?,'{}')`,
      )
      .bind(primaryName, primaryKey, originalName, originalKey)], {
        actor, eventType: "admin_character_create", targets: "character", snapshot,
        permission: "character.create", source: "admin",
      });
  } catch (error) {
    if (isCharacterIdentityConstraintError(error)) {
      throw new HttpError(
        409,
        `日语名“${originalName}”刚刚被其他操作占用，请重新提交以打开已有角色。`,
        "character_name_conflict",
      );
    }
    throw error;
  }

  const created = await database
    .prepare(`SELECT id FROM characters WHERE original_name_key=? LIMIT 1`)
    .bind(originalKey)
    .first<{ id: number }>();
  if (!created) throw new Error("角色创建后不可读取");
  const character = await getCharacterForAdminEdit(runtime, created.id);
  if (!character) throw new Error("角色创建后不可读取");
  return { character, created: true };
}
export async function updateCharacterForAdmin(
  runtime: AppRuntime,
  input: {
    characterId: number;
    primaryName: string;
    originalName: string;
    description?: string | null;
    japaneseAliases: string[];
    chineseAliases: string[];
    mergeTargetId: number | null;
    mergeSourceId: number | null;
  },
  actor: ArchiveUser,
): Promise<AdminCharacterEdit> {
  const primaryName = normalizeEntityName(input.primaryName);
  if (!primaryName)
    throw new HttpError(400, "角色名称不能为空。", "character_name_required");
  const originalName = normalizeEntityName(input.originalName);
  if (!originalName)
    throw new HttpError(
      400,
      "角色原名不能为空。",
      "character_original_name_required",
    );
  if (input.mergeTargetId && input.mergeSourceId) {
    throw new HttpError(
      400,
      "一次只能选择一个合并方向，请取消其中一个合并操作后重试。",
      "character_merge_direction_conflict",
    );
  }
  if (input.mergeTargetId) {
    await mergeCharacter(runtime, input.characterId, input.mergeTargetId, actor);
    const target = await getCharacterById(runtime, input.mergeTargetId, true);
    if (!target)
      throw new HttpError(
        404,
        "合并目标不存在，请刷新页面后重新选择。",
        "character_merge_target_missing",
      );
    return target;
  }
  const existingCharacter = await getCharacterForAdminEdit(
    runtime,
    input.characterId,
  );
  if (!existingCharacter)
    throw new HttpError(404, "角色不存在，请刷新后重试。", "character_missing");
  const aliases = [
    ...normalizeCharacterAliases(input.japaneseAliases, "ja", originalName),
    ...normalizeCharacterAliases(input.chineseAliases, "zh", primaryName),
  ];
  assertAliasLanguagesDoNotOverlap(aliases);
  const database = getD1(runtime);
  const identityConflicts = await findCharacterIdentityConflicts(
    database,
    input.characterId,
    originalName,
    aliases.filter((alias) => alias.language === "ja"),
  );
  let aliasesToSave = aliases;
  let mergeStatements: D1PreparedStatement[] = [];
  if (input.mergeSourceId) {
    assertConfirmedAliasMerge(
      identityConflicts,
      input.characterId,
      input.mergeSourceId,
    );
    const preparedMerge = await prepareCharacterMerge(
      database,
      input.mergeSourceId,
      input.characterId,
    );
    aliasesToSave = mergeCharacterAliases(
      aliases,
      preparedMerge.sourceAliases,
      preparedMerge.source,
      primaryName,
      originalName,
    );
    mergeStatements = preparedMerge.statements;
  } else {
    assertCharacterIdentityAvailable(identityConflicts, input.characterId);
  }
  try {
    await auditedEntityBatch(database, [
      ...mergeStatements,
      ...characterUpdateStatements(database, {
        characterId: input.characterId,
        primaryName,
        originalName,
        description:
          input.description === undefined
            ? existingCharacter.description
            : input.description,
        aliases: aliasesToSave,
      }),
    ], { actor, eventType: "admin_character_update", targets: [
      { type: "character", id: input.characterId },
      ...(input.mergeSourceId ? [{ type: "character" as const, id: input.mergeSourceId }] : []),
    ], snapshot: input.mergeSourceId ? combinedAuditSnapshot({
      target: characterAuditSnapshot(input.characterId, true), source: characterAuditSnapshot(input.mergeSourceId, true),
    }) : characterAuditSnapshot(input.characterId),
    permission: input.mergeSourceId ? "character.merge_any" : "character.metadata.update_any", source: "admin",
    operation: input.mergeSourceId ? "mergeSource" : "metadata" });
  } catch (error) {
    if (isCharacterIdentityConstraintError(error)) {
      throw new HttpError(
        409,
        "角色原名或日文别名刚刚被其他角色占用。请刷新页面后重试；如果两条记录是同一角色，请使用“合并重复角色”。",
        "character_name_conflict",
      );
    }
    throw error;
  }
  const updated = await getCharacterForAdminEdit(runtime, input.characterId);
  if (!updated) throw new Error("角色更新后不可读取");
  return updated;
}
export function parseCharacterEditForm(
  form: FormData,
): Parameters<typeof updateCharacterForAdmin>[1] {
  const id = positive(form.get("character_id"));
  return {
    characterId: id,
    primaryName: String(form.get("primary_name") ?? ""),
    originalName: String(form.get("original_name") ?? ""),
    japaneseAliases: lines(form.get("japanese_aliases")),
    chineseAliases: lines(form.get("chinese_aliases")),
    mergeTargetId: nullablePositive(form.get("merge_target_id")),
    mergeSourceId: nullablePositive(form.get("merge_source_id")),
  };
}

export async function listPublicTags(
  runtime: AppRuntime,
  input: { query?: string; limit?: number } = {},
): Promise<PublicTagSummary[]> {
  const binds: Array<string | number> = [];
  const where = [
    `EXISTS(SELECT 1 FROM tag_usage_stats s WHERE s.name=t.name AND s.public_count > 0)`,
  ];
  if (input.query?.trim()) {
    const q = `%${input.query.trim()}%`;
    where.push("t.name LIKE ?");
    binds.push(q);
  }
  const rows = await getD1(runtime)
    .prepare(
      `${tagSql()} FROM tags t WHERE ${where.join(" AND ")} ORDER BY work_count DESC,t.name ASC LIMIT ?`,
    )
    .bind(...binds, limitValue(input.limit ?? 120, 300))
    .all<TagRow>();
  return (rows.results ?? []).map(mapTag);
}
export async function getPublicTagSummary(
  runtime: AppRuntime,
  name: string,
): Promise<PublicTagSummary | null> {
  const tag = await getTagForAdminEdit(runtime, name);
  return tag && tag.workCount > 0 ? tag : null;
}
export async function searchTagsForAdmin(
  runtime: AppRuntime,
  input: {
    query?: string;
    namespace?: string;
    sort?: "default" | "name" | "works";
    page?: number;
    pageSize?: number;
  },
): Promise<{
  items: PublicTagSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const pageSize = limitValue(input.pageSize ?? 50, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const binds: Array<string | number> = [];
  const clauses: string[] = [];
  if (input.query?.trim()) {
    clauses.push("t.name LIKE ?");
    binds.push(`%${input.query.trim()}%`);
  }
  if (input.namespace && input.namespace !== "all") {
    clauses.push("t.namespace=?");
    binds.push(input.namespace);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order =
    input.sort === "name"
      ? "t.name ASC"
      : input.sort === "works"
        ? "work_count DESC,t.name ASC"
        : "t.updated_at DESC,t.name ASC";
  const database = getD1(runtime);
  const [rowsResult, countResult] = await database.batch([
    database
      .prepare(
        `${tagSql()} FROM tags t ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .bind(...binds, pageSize, (page - 1) * pageSize),
    database
      .prepare(`SELECT COUNT(*) AS count FROM tags t ${where}`)
      .bind(...binds),
  ]);
  return {
    items: ((rowsResult.results ?? []) as TagRow[]).map(mapTag),
    total: Number(
      (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    page,
    pageSize,
  };
}
export async function getTagForAdminEdit(
  runtime: AppRuntime,
  name: string,
): Promise<AdminTagEdit | null> {
  const row = await getD1(runtime)
    .prepare(`${tagSql()} FROM tags t WHERE t.name=? LIMIT 1`)
    .bind(normalizeEntityName(name))
    .first<TagRow>();
  return row ? mapTag(row) : null;
}
export async function updateTagForAdmin(
  runtime: AppRuntime,
  input: {
    originalName: string;
    namespace: string;
    description: string | null;
  },
  actor: ArchiveUser,
): Promise<AdminTagEdit> {
  const name = normalizeEntityName(input.originalName);
  if (!name)
    throw new HttpError(400, "标签名称不能为空。", "tag_name_required");
  if (
    !["genre", "theme", "character", "technical", "content", "other"].includes(
      input.namespace,
    )
  )
    throw new HttpError(
      400,
      "标签命名空间不合法，请重新选择。",
      "tag_namespace_invalid",
    );
  const original = await getTagForAdminEdit(runtime, input.originalName);
  if (!original) {
    throw new HttpError(
      404,
      "公共标签不存在，请返回列表后重新进入。",
      "tag_not_found",
    );
  }
  const database = getD1(runtime);
  const [result] = await auditedEntityBatch(database, [database.prepare(
    `UPDATE tags SET namespace=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE name=?`,
  ).bind(input.namespace, input.description, original.name)], {
    actor, eventType: "admin_tag_update", targets: [{ type: "tag", id: original.name }],
    snapshot: tagAuditSnapshot(original.name), permission: "tag.metadata.update_any", source: "admin",
  });
  if (!result.meta.changes) {
    throw new HttpError(409, "公共标签已变更，请刷新页面后重试。", "tag_changed");
  }
  const updated = await getTagForAdminEdit(runtime, name);
  if (!updated) throw new Error("标签更新后不可读取");
  return updated;
}
export function parseTagEditForm(
  form: FormData,
): Parameters<typeof updateTagForAdmin>[1] {
  const originalName = normalizeEntityName(String(form.get("original_name") ?? ""));
  const submittedName = form.get("name");
  if ((submittedName !== null && normalizeEntityName(String(submittedName)) !== originalName)
    || String(form.get("merge_target_name") ?? "").trim()) {
    throw new HttpError(400, "标签名称不能更改，也不支持合并或删除。", "tag_identity_immutable");
  }
  return {
    originalName,
    namespace: String(form.get("namespace") ?? "other"),
    description: clean(form.get("description")),
  };
}

async function getCharacter(
  runtime: AppRuntime,
  id: number,
  includeNonPublic: boolean,
): Promise<PublicCharacterSummary | null> {
  const row = await getD1(runtime)
    .prepare(`${characterSql(!includeNonPublic)} WHERE ch.id=? LIMIT 1`)
    .bind(id)
    .first<CharacterRow>();
  if (!row) return null;
  if (!includeNonPublic && row.work_count === 0) return null;
  return mapCharacter(row);
}
async function getCharacterById(
  runtime: AppRuntime,
  id: number,
  includeNonPublic: boolean,
): Promise<AdminCharacterEdit | null> {
  const character = await getCharacterForAdminEdit(runtime, id);
  if (!character || (!includeNonPublic && character.workCount === 0))
    return null;
  return character;
}
type CharacterMergeRow = {
  id: number;
  primary_name: string;
  primary_name_key: string;
  original_name: string;
  original_name_key: string;
};

async function mergeCharacter(
  runtime: AppRuntime,
  id: number,
  targetId: number,
  actor: ArchiveUser,
): Promise<void> {
  const database = getD1(runtime);
  const prepared = await prepareCharacterMerge(database, id, targetId);
  await auditedEntityBatch(database, prepared.statements, {
    actor, eventType: "admin_character_update", targets: [{ type: "character", id }, { type: "character", id: targetId }],
    snapshot: combinedAuditSnapshot({ source: characterAuditSnapshot(id, true), target: characterAuditSnapshot(targetId, true) }),
    permission: "character.merge_any", source: "admin", operation: "mergeTarget",
  });
}

async function prepareCharacterMerge(
  database: D1Database,
  id: number,
  targetId: number,
): Promise<{
  source: CharacterMergeRow;
  sourceAliases: CharacterAliasSuggestion[];
  statements: D1PreparedStatement[];
}> {
  const [source, target, sourceAliasesResult] = await database.batch([
    database
      .prepare(
        `SELECT id,primary_name,primary_name_key,original_name,original_name_key FROM characters WHERE id=? LIMIT 1`,
      )
      .bind(id),
    database
      .prepare(
        `SELECT id,primary_name,primary_name_key,original_name,original_name_key FROM characters WHERE id=? LIMIT 1`,
      )
      .bind(targetId),
    database
      .prepare(
        `SELECT name,language FROM character_aliases WHERE character_id=? ORDER BY id`,
      )
      .bind(id),
  ]);
  const sourceRow = source.results?.[0] as CharacterMergeRow | undefined;
  const targetRow = target.results?.[0] as CharacterMergeRow | undefined;
  if (!sourceRow || !targetRow || targetRow.id === sourceRow.id) {
    throw new HttpError(
      400,
      "角色合并目标不合法，请重新选择。",
      "character_merge_target_invalid",
    );
  }
  const statements = [
    database
      .prepare(
        `INSERT OR IGNORE INTO character_face_sheet_bindings(character_id,face_sheet_id,sort_order)
         SELECT ?,face_sheet_id,sort_order FROM character_face_sheet_bindings WHERE character_id=?`,
      )
      .bind(targetRow.id, sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_portrait_refs(character_id,face_sheet_id,cell_row,cell_column,created_by_user_id)
         SELECT ?,face_sheet_id,cell_row,cell_column,created_by_user_id
         FROM character_portrait_refs WHERE character_id=?`,
      )
      .bind(targetRow.id, sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_default_portraits(character_id,portrait_ref_id)
         SELECT ?,target_ref.id
         FROM character_default_portraits source_default
         JOIN character_portrait_refs source_ref ON source_ref.id=source_default.portrait_ref_id
         JOIN character_portrait_refs target_ref
           ON target_ref.character_id=?
          AND target_ref.face_sheet_id=source_ref.face_sheet_id
          AND target_ref.cell_row=source_ref.cell_row
          AND target_ref.cell_column=source_ref.cell_column
         WHERE source_default.character_id=?`,
      )
      .bind(targetRow.id, targetRow.id, sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO work_characters(work_id,character_id,portrait_ref_id,display_name,role_key,spoiler_level,sort_order,notes)
         SELECT wc.work_id,?,target_ref.id,wc.display_name,wc.role_key,wc.spoiler_level,wc.sort_order,wc.notes
         FROM work_characters wc
         LEFT JOIN character_portrait_refs source_ref ON source_ref.id=wc.portrait_ref_id
         LEFT JOIN character_portrait_refs target_ref
           ON target_ref.character_id=?
          AND target_ref.face_sheet_id=source_ref.face_sheet_id
          AND target_ref.cell_row=source_ref.cell_row
          AND target_ref.cell_column=source_ref.cell_column
         WHERE wc.character_id=?`,
      )
      .bind(targetRow.id, targetRow.id, sourceRow.id),
    database
      .prepare(`DELETE FROM work_characters WHERE character_id=?`)
      .bind(sourceRow.id),
    database
      .prepare(
        `DELETE FROM character_aliases
         WHERE character_id=? AND (
           name_key IN (SELECT name_key FROM character_aliases WHERE character_id=?)
           OR name_key=? OR name_key=?
         )`,
      )
      .bind(
        sourceRow.id,
        targetRow.id,
        targetRow.primary_name_key,
        targetRow.original_name_key,
      ),
    database
      .prepare(
        `UPDATE character_aliases SET character_id=? WHERE character_id=?`,
      )
      .bind(targetRow.id, sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_category_memberships(category_id,character_id,sort_order,display_name,original_name) SELECT category_id,?,sort_order,COALESCE(display_name,?),COALESCE(original_name,?) FROM character_category_memberships WHERE character_id=?`,
      )
      .bind(
        targetRow.id,
        sourceRow.primary_name,
        sourceRow.original_name,
        sourceRow.id,
      ),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_sources(character_id,url,sort_order) SELECT ?,url,sort_order FROM character_sources WHERE character_id=?`,
      )
      .bind(targetRow.id, sourceRow.id),
    database
      .prepare(`UPDATE comments SET character_id=? WHERE character_id=?`)
      .bind(targetRow.id, sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_material_bindings(character_id,material_id,sort_order) SELECT ?,material_id,sort_order FROM character_material_bindings WHERE character_id=?`,
      )
      .bind(targetRow.id, sourceRow.id),
    database.prepare(`UPDATE user_showcase_entries SET character_id=?,portrait_ref_id=(
      SELECT target_ref.id FROM character_portrait_refs source_ref JOIN character_portrait_refs target_ref
        ON target_ref.character_id=? AND target_ref.face_sheet_id=source_ref.face_sheet_id
        AND target_ref.cell_row=source_ref.cell_row AND target_ref.cell_column=source_ref.cell_column
      WHERE source_ref.id=user_showcase_entries.portrait_ref_id
    ) WHERE character_id=?`).bind(targetRow.id, targetRow.id, sourceRow.id),
    database.prepare(`DELETE FROM characters WHERE id=?`).bind(sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_aliases(character_id,name,name_key,language,source)
         SELECT ?,?,?,'ja','admin'
         WHERE ?<>? AND ?<>?
           AND NOT EXISTS(SELECT 1 FROM character_aliases WHERE character_id=? AND name_key=?)`,
      )
      .bind(
        targetRow.id,
        sourceRow.original_name,
        sourceRow.original_name_key,
        sourceRow.original_name_key,
        targetRow.original_name_key,
        sourceRow.original_name_key,
        targetRow.primary_name_key,
        targetRow.id,
        sourceRow.original_name_key,
      ),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_aliases(character_id,name,name_key,language,source)
         SELECT ?,?,?,'zh','admin'
         WHERE ?<>? AND ?<>?
           AND NOT EXISTS(SELECT 1 FROM character_aliases WHERE character_id=? AND name_key=?)`,
      )
      .bind(
        targetRow.id,
        sourceRow.primary_name,
        sourceRow.primary_name_key,
        sourceRow.primary_name_key,
        targetRow.primary_name_key,
        sourceRow.primary_name_key,
        targetRow.original_name_key,
        targetRow.id,
        sourceRow.primary_name_key,
      ),
  ];
  return {
    source: sourceRow,
    sourceAliases: (sourceAliasesResult.results ?? []).map((row) => ({
      name: String((row as { name: string }).name),
      language: (row as { language: "ja" | "zh" }).language,
    })),
    statements,
  };
}
function characterSql(publicPortrait = false, groupedWorkCounts = false, fields: "summary" | "index" = "summary"): string {
  // Full indexes count public credits once; individual lookups keep their indexed count.
  const counts = groupedWorkCounts
    ? `WITH character_work_counts AS MATERIALIZED (
        SELECT character_id,COUNT(DISTINCT work_id) AS work_count
        FROM work_characters WHERE work_id IN (SELECT id FROM public_works)
        GROUP BY character_id
      ) `
    : "";
  const workCount = groupedWorkCounts
    ? "COALESCE(work_counts.work_count,0)"
    : "(SELECT COUNT(DISTINCT wc.work_id) FROM work_characters wc JOIN works w ON w.id=wc.work_id WHERE wc.character_id=ch.id AND w.id IN (SELECT id FROM public_works))";
  return `${counts}SELECT ch.id,ch.primary_name,ch.original_name,${fields === "summary" ? "ch.description,ch.extra_json,ch.updated_at," : ""}${CHARACTER_PORTRAIT_COLUMNS},${workCount} AS work_count FROM characters ch ${DEFAULT_CHARACTER_PORTRAIT_JOINS}${publicPortrait ? ` AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}` : ""}${groupedWorkCounts ? " LEFT JOIN character_work_counts work_counts ON work_counts.character_id=ch.id" : ""}`;
}
function tagSql(): string {
  return `SELECT t.name,t.namespace,t.description,COALESCE((SELECT public_count FROM tag_usage_stats WHERE name=t.name),0) AS work_count,t.updated_at`;
}
function mapCharacter(row: CharacterRow): PublicCharacterSummary {
  return {
    id: row.id,
    primaryName: row.primary_name,
    originalName: row.original_name,
    defaultPortrait: mapCharacterPortrait(row),
    description: row.description,
    workCount: row.work_count,
    updatedAt: row.updated_at,
  };
}

function normalizeCharacterAliases(
  values: string[],
  language: "ja" | "zh",
  canonicalName: string,
): CharacterAliasSuggestion[] {
  const canonicalKey = characterNameKey(canonicalName);
  const seen = new Set<string>();
  const result: CharacterAliasSuggestion[] = [];
  for (const value of values) {
    const name = normalizeEntityName(value);
    const key = characterNameKey(name);
    if (!key || key === canonicalKey || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, language });
  }
  return result;
}

function assertAliasLanguagesDoNotOverlap(
  aliases: CharacterAliasSuggestion[],
): void {
  const languageByKey = new Map<string, CharacterAliasSuggestion>();
  for (const alias of aliases) {
    const key = characterNameKey(alias.name);
    const existing = languageByKey.get(key);
    if (existing && existing.language !== alias.language) {
      throw new HttpError(
        400,
        `别名“${alias.name}”同时填写在日文别名和中文别名中。请只保留在正确的语言栏。`,
        "character_alias_language_conflict",
      );
    }
    languageByKey.set(key, alias);
  }
}

type CharacterIdentityConflict = {
  characterId: number;
  primaryName: string;
  originalName: string;
  occupiedName: string;
  occupiedAs: "original" | "alias";
  inputKind: "original" | "alias";
  inputName: string;
};

async function findCharacterIdentityConflicts(
  database: D1Database,
  characterId: number,
  originalName: string,
  japaneseAliases: CharacterAliasSuggestion[],
): Promise<CharacterIdentityConflict[]> {
  const originalKey = characterNameKey(originalName);
  const submitted = new Map<
    string,
    { kind: "original" | "alias"; name: string }
  >([[originalKey, { kind: "original", name: originalName }]]);
  for (const alias of japaneseAliases) {
    submitted.set(characterNameKey(alias.name), {
      kind: "alias",
      name: alias.name,
    });
  }

  const rows = await database
    .prepare(
      `WITH submitted(name_key) AS (
       SELECT value FROM json_each(?)
     )
     SELECT c.id,c.primary_name,c.original_name,c.original_name_key AS name_key,
            c.original_name AS occupied_name,'original' AS occupied_as
     FROM characters c
     JOIN submitted s ON s.name_key=c.original_name_key
     WHERE c.id<>?
     UNION ALL
     SELECT c.id,c.primary_name,c.original_name,ca.name_key,
            ca.name AS occupied_name,'alias' AS occupied_as
     FROM character_aliases ca
     JOIN characters c ON c.id=ca.character_id
     JOIN submitted s ON s.name_key=ca.name_key
     WHERE ca.language='ja' AND c.id<>?
     ORDER BY id,name_key,occupied_as`,
    )
    .bind(JSON.stringify([...submitted.keys()]), characterId, characterId)
    .all<{
      id: number;
      primary_name: string;
      original_name: string;
      name_key: string;
      occupied_name: string;
      occupied_as: "original" | "alias";
    }>();
  return (rows.results ?? []).flatMap((row) => {
    const input = submitted.get(row.name_key);
    return input
      ? [
          {
            characterId: row.id,
            primaryName: row.primary_name,
            originalName: row.original_name,
            occupiedName: row.occupied_name,
            occupiedAs: row.occupied_as,
            inputKind: input.kind,
            inputName: input.name,
          },
        ]
      : [];
  });
}

function assertCharacterIdentityAvailable(
  conflicts: CharacterIdentityConflict[],
  currentCharacterId: number,
): void {
  if (!conflicts.length) return;
  const originalConflict = conflicts.find(
    (conflict) => conflict.inputKind === "original",
  );
  if (originalConflict) {
    const occupiedAs =
      originalConflict.occupiedAs === "original"
        ? "原名"
        : `日文别名“${originalConflict.occupiedName}”`;
    throw new HttpError(
      409,
      `角色原名“${originalConflict.inputName}”已被角色 #${originalConflict.characterId}“${originalConflict.originalName} · ${originalConflict.primaryName}”用作${occupiedAs}。请修改角色原名；如果两条记录是同一角色，请使用页面下方的“合并重复角色”。`,
      "character_name_conflict",
    );
  }

  const ownerIds = new Set(conflicts.map((conflict) => conflict.characterId));
  if (ownerIds.size === 1) {
    const first = conflicts[0];
    throw new CharacterAliasMergeConflictError(
      [...new Set(conflicts.map((conflict) => conflict.inputName))],
      currentCharacterId,
      {
        id: first.characterId,
        primaryName: first.primaryName,
        originalName: first.originalName,
      },
    );
  }

  throw new HttpError(
    409,
    `日文别名${formatQuotedNames([...new Set(conflicts.map((conflict) => conflict.inputName))])}分别归属于多个角色，不能一次合并。请每次只保留属于同一角色的冲突别名，逐个处理。`,
    "character_alias_multiple_conflicts",
  );
}

function assertConfirmedAliasMerge(
  conflicts: CharacterIdentityConflict[],
  currentCharacterId: number,
  mergeSourceId: number,
): void {
  if (
    mergeSourceId === currentCharacterId ||
    !conflicts.length ||
    conflicts.some(
      (conflict) =>
        conflict.inputKind !== "alias" ||
        conflict.characterId !== mergeSourceId,
    )
  ) {
    throw new HttpError(
      409,
      "别名占用关系已经变化，未执行合并。请重新保存并确认最新提示。",
      "character_alias_merge_stale",
    );
  }
}

function mergeCharacterAliases(
  submittedAliases: CharacterAliasSuggestion[],
  sourceAliases: CharacterAliasSuggestion[],
  source: CharacterMergeRow,
  targetPrimaryName: string,
  targetOriginalName: string,
): CharacterAliasSuggestion[] {
  const aliases = new Map<string, CharacterAliasSuggestion>();
  const targetNameKeys = new Set([
    characterNameKey(targetPrimaryName),
    characterNameKey(targetOriginalName),
  ]);
  const addSourceAlias = (alias: CharacterAliasSuggestion) => {
    const key = characterNameKey(alias.name);
    if (!key || targetNameKeys.has(key) || aliases.has(key)) return;
    aliases.set(key, alias);
  };
  for (const alias of sourceAliases) addSourceAlias(alias);
  addSourceAlias({ name: source.original_name, language: "ja" });
  addSourceAlias({ name: source.primary_name, language: "zh" });
  for (const alias of submittedAliases) {
    aliases.set(characterNameKey(alias.name), alias);
  }
  return [...aliases.values()];
}

function characterUpdateStatements(
  database: D1Database,
  input: {
    characterId: number;
    primaryName: string;
    originalName: string;
    description: string | null;
    aliases: CharacterAliasSuggestion[];
  },
): D1PreparedStatement[] {
  return [
    database
      .prepare(`DELETE FROM character_aliases WHERE character_id=?`)
      .bind(input.characterId),
    database
      .prepare(
        `UPDATE characters
       SET primary_name=?,primary_name_key=?,original_name=?,original_name_key=?,description=?,
             updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      )
      .bind(
        input.primaryName,
        characterNameKey(input.primaryName),
        input.originalName,
        characterNameKey(input.originalName),
        input.description,
        input.characterId,
      ),
    ...input.aliases.map((alias) =>
      database
        .prepare(
          `INSERT INTO character_aliases(character_id,name,name_key,language,source)
       VALUES(?,?,?,?,'admin')`,
        )
        .bind(
          input.characterId,
          alias.name,
          characterNameKey(alias.name),
          alias.language,
        ),
    ),
  ];
}

function formatQuotedNames(values: string[]): string {
  return values.map((value) => `“${value}”`).join("、");
}

function isCharacterIdentityConstraintError(error: unknown): boolean {
  return /character original name already belongs to an alias|character alias already belongs to an original name|unique constraint failed: characters\.original_name_key|unique constraint failed: character_aliases\.(?:name_key|character_id, character_aliases\.name_key)/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
function mapTag(row: TagRow): PublicTagSummary {
  return {
    name: row.name,
    namespace: row.namespace,
    description: row.description,
    workCount: row.work_count,
    updatedAt: row.updated_at,
  };
}
function parseExtra(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    /* Malformed optional metadata is treated as empty. */
  }
  return {};
}
function clean(value: FormDataEntryValue | null): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}
function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,，\r\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
function positive(value: FormDataEntryValue | null): number {
  const id = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(
      400,
      "提交的记录 ID 不合法，请刷新页面后重试。",
      "record_id_invalid",
    );
  }
  return id;
}
function nullablePositive(value: FormDataEntryValue | null): number | null {
  if (!String(value ?? "").trim()) return null;
  return positive(value);
}
function limitValue(value: number, max: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(max, Math.floor(value)))
    : 1;
}
