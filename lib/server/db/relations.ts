import { relationInverse, isLanguageCode } from "@/lib/labels";
import type { ArchiveUser } from "@/lib/server/db/users";
import { getD1 } from "@/lib/server/db/d1";
import { HttpError } from "@/lib/server/http/json";

export type RelationType =
  | "adaptation"
  | "prequel"
  | "sequel"
  | "same_setting"
  | "alternative_setting"
  | "alternative_version"
  | "character"
  | "collaboration"
  | "version"
  | "main_version"
  | "collection"
  | "in_collection";

export type TranslationRole = "original" | "translation";

export type WorkRelationInput = {
  fromWorkId: number;
  toWorkId: number;
  relationType: RelationType;
};

export type WorkRelationUpdateInput = {
  relationType: RelationType;
};

export type TranslationRelationInput = {
  sourceWorkId: number;
  targetRole: TranslationRole;
  targetWorkId: number;
};

type RelationRow = {
  id: number;
  from_work_id: number;
  to_work_id: number;
  relation_type: RelationType;
  vice_versa: number;
  created_by_user_id: number | null;
};

type TranslationRoleRow = {
  source_work_id: number;
  target_work_id: number;
  target_role: TranslationRole;
};

export async function createWorkRelation(
  input: WorkRelationInput,
  actor: ArchiveUser,
): Promise<{ id: number }> {
  assertPositiveIds(input.fromWorkId, input.toWorkId);
  assertRelationType(input.relationType);
  if (input.fromWorkId === input.toWorkId)
    throw new HttpError(400, "不能关联自身");
  assertCanCreateWorkRelation(actor);
  await assertAccessibleWorks(
    actor,
    "relation",
    input.fromWorkId,
    input.toWorkId,
  );
  const inverse = relationInverse(input.relationType);
  if (
    await hasLogicalRelation(
      input.fromWorkId,
      input.toWorkId,
      input.relationType,
      inverse as RelationType | null,
    )
  ) {
    throw new HttpError(409, "该普通关联已存在");
  }
  const database = getD1();
  const statements = [
    database
      .prepare(
        `INSERT INTO work_relations (from_work_id,to_work_id,relation_type,vice_versa,created_by_user_id)
       VALUES (?, ?, ?, 0, ?)`,
      )
      .bind(
        input.fromWorkId,
        input.toWorkId,
        input.relationType,
        actor.id,
      ),
  ];
  if (inverse) {
    statements.push(
      database
        .prepare(
          `INSERT INTO work_relations (from_work_id,to_work_id,relation_type,vice_versa,created_by_user_id)
         VALUES (?, ?, ?, 1, ?)`,
        )
        .bind(
          input.toWorkId,
          input.fromWorkId,
          inverse as RelationType,
          actor.id,
        ),
    );
  }
  let result: Awaited<ReturnType<typeof database.batch>>;
  try {
    result = await database.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) throw new HttpError(409, "该普通关联已存在");
    throw error;
  }
  const id = result[0]?.meta.last_row_id;
  if (!Number.isSafeInteger(id)) throw new Error("关联未创建");
  return { id };
}

export async function updateWorkRelation(
  id: number,
  input: WorkRelationUpdateInput,
  actor: ArchiveUser,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new HttpError(400, "关联 ID 不合法");
  const row = await relationById(id);
  if (!row) throw new HttpError(404, "关联不存在");
  await assertCanModifyRelation(row, actor, "relation.update_own");
  assertRelationType(input.relationType);
  if (input.relationType === row.relation_type && row.vice_versa === 0) return;

  const database = getD1();
  const nextType = input.relationType;
  const inverse = relationInverse(nextType);
  const oldInverse = relationInverse(row.relation_type);
  const inverseRow = oldInverse
    ? await database
        .prepare(
          `SELECT id FROM work_relations
           WHERE from_work_id=? AND to_work_id=? AND relation_type=? AND vice_versa=?
           LIMIT 1`,
        )
        .bind(
          row.to_work_id,
          row.from_work_id,
          oldInverse,
          row.vice_versa === 0 ? 1 : 0,
        )
        .first<{ id: number }>()
    : null;
  const ignoredIds = [id, ...(inverseRow?.id ? [inverseRow.id] : [])];
  if (
    (await hasLogicalRelation(
      row.from_work_id,
      row.to_work_id,
      nextType,
      inverse as RelationType | null,
      ignoredIds,
    ))
  ) {
    throw new HttpError(409, "该普通关联已存在");
  }
  const statements = [];
  if (inverseRow) {
    statements.push(
      database
        .prepare(`DELETE FROM work_relations WHERE id=?`)
        .bind(inverseRow.id),
    );
  }
  statements.push(
    database
      .prepare(`UPDATE work_relations SET relation_type=?,vice_versa=0 WHERE id=?`)
      .bind(nextType, id),
  );
  if (inverse) {
    statements.push(
      database
        .prepare(
          `INSERT INTO work_relations(from_work_id,to_work_id,relation_type,vice_versa,created_by_user_id)
           VALUES(?,?,?,1,?)`,
        )
        .bind(
          row.to_work_id,
          row.from_work_id,
          inverse,
          row.created_by_user_id,
        ),
    );
  }
  try {
    await database.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) throw new HttpError(409, "该普通关联已存在");
    throw error;
  }
}

export async function deleteWorkRelation(
  id: number,
  actor: ArchiveUser,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new HttpError(400, "关联 ID 不合法");
  const row = await relationById(id);
  if (!row) throw new HttpError(404, "关联不存在");
  await assertCanModifyRelation(row, actor, "relation.delete_own");
  const database = getD1();
  const statements = [
    database.prepare(`DELETE FROM work_relations WHERE id=?`).bind(id),
  ];
  if (row.vice_versa === 0) {
    const inverse = relationInverse(row.relation_type);
    if (inverse) {
      statements.push(
        database
          .prepare(
            `DELETE FROM work_relations WHERE from_work_id=? AND to_work_id=? AND relation_type=? AND vice_versa=1`,
          )
          .bind(row.to_work_id, row.from_work_id, inverse),
      );
    }
  } else {
    const inverse = relationInverse(row.relation_type);
    if (inverse) {
      statements.push(
        database
          .prepare(
            `DELETE FROM work_relations WHERE from_work_id=? AND to_work_id=? AND relation_type=? AND vice_versa=0`,
          )
          .bind(row.to_work_id, row.from_work_id, inverse),
      );
    }
  }
  await database.batch(statements);
}

export async function createTranslationRelation(
  input: TranslationRelationInput,
  actor: ArchiveUser,
): Promise<{ id: number }> {
  assertPositiveIds(input.sourceWorkId, input.targetWorkId);
  if (input.sourceWorkId === input.targetWorkId)
    throw new HttpError(400, "不能关联自身");
  if (input.targetRole !== "original" && input.targetRole !== "translation")
    throw new HttpError(400, "翻译角色不合法");
  assertCanCreateTranslationRelation(actor);
  const database = getD1();
  const canReadPrivate = actor.permissionKeys.includes("work.read_private") ||
    actor.permissionKeys.includes("translation_relation.manage_any");
  const canReadOwn = actor.permissionKeys.includes("work.update_own");
  const originalSourceId = input.targetRole === "original"
    ? input.sourceWorkId
    : input.targetWorkId;
  const validation = await database.batch([
    database
      .prepare(
        `SELECT w.id,w.language
         FROM works w
         WHERE w.id IN (?,?) AND w.status<>'deleted'
           AND (
             w.status='published' OR ?=1 OR
             (?=1 AND EXISTS(
               SELECT 1 FROM work_uploaders wu
               WHERE wu.work_id=w.id AND wu.user_id=?
             ))
           )`,
      )
      .bind(
        input.sourceWorkId,
        input.targetWorkId,
        canReadPrivate ? 1 : 0,
        canReadOwn ? 1 : 0,
        actor.id,
      ),
    database
      .prepare(
        `SELECT source_work_id,target_work_id,target_role
         FROM translation_relations
         WHERE source_work_id IN (?,?) OR target_work_id IN (?,?)`,
      )
      .bind(input.sourceWorkId, input.targetWorkId, input.sourceWorkId, input.targetWorkId),
    database
      .prepare(
        `SELECT 1 AS present FROM translation_relations
         WHERE source_work_id=? AND target_role='original' LIMIT 1`,
      )
      .bind(originalSourceId),
    database
      .prepare(
        `SELECT 1 AS present FROM translation_relations
         WHERE (source_work_id=? AND target_work_id=?)
            OR (source_work_id=? AND target_work_id=?)
         LIMIT 1`,
      )
      .bind(input.sourceWorkId, input.targetWorkId, input.targetWorkId, input.sourceWorkId),
  ]);
  const works = (validation[0].results ?? []) as Array<{ id: number; language: string }>;
  const source = works.find((work) => work.id === input.sourceWorkId);
  const target = works.find((work) => work.id === input.targetWorkId);
  if (!source || !target) throw new HttpError(404, "目标游戏不存在");
  if (
    !isLanguageCode(source.language) ||
    !isLanguageCode(target.language) ||
    source.language === target.language
  )
    throw new HttpError(400, "原版和译版语言必须不同");

  const sourceGameRole: TranslationRole =
    input.targetRole === "original" ? "translation" : "original";
  const targetGameRole: TranslationRole =
    sourceGameRole === "original" ? "translation" : "original";
  const relationRows = (validation[1].results ?? []) as TranslationRoleRow[];
  const currentRole = translationRoleFromRows(input.sourceWorkId, relationRows);
  if (currentRole && currentRole !== sourceGameRole)
    throw new HttpError(400, "一个游戏不能同时作为原版和译版");
  const targetExistingRole = translationRoleFromRows(input.targetWorkId, relationRows);
  if (targetExistingRole && targetExistingRole !== targetGameRole)
    throw new HttpError(400, "一个游戏不能同时作为原版和译版");
  const targetRole =
    input.targetRole === "original" ? "translation" : "original";
  if (validation[2].results?.length) throw new HttpError(409, "一个译本最多关联一个原版");
  if (validation[3].results?.length) throw new HttpError(409, "该翻译关联已存在");

  let result: Awaited<ReturnType<typeof database.batch>>;
  try {
    result = await database.batch([
        database
          .prepare(
          `INSERT INTO translation_relations (source_work_id,target_role,target_work_id,vice_versa,created_by_user_id)
           VALUES (?, ?, ?, 0, ?)`,
        )
        .bind(
          input.sourceWorkId,
          input.targetRole,
          input.targetWorkId,
          actor.id,
        ),
        database
          .prepare(
          `INSERT INTO translation_relations (source_work_id,target_role,target_work_id,vice_versa,created_by_user_id)
           VALUES (?, ?, ?, 1, ?)`,
        )
        .bind(
          input.targetWorkId,
          targetRole,
          input.sourceWorkId,
          actor.id,
        ),
    ]);
  } catch (error) {
    if (isConstraintError(error))
      throw new HttpError(409, "该翻译关联已存在或角色冲突");
    throw error;
  }
  const id = result[0]?.meta.last_row_id;
  if (!Number.isSafeInteger(id)) throw new Error("翻译关联未创建");
  return { id };
}

export async function deleteTranslationRelation(
  id: number,
  actor: ArchiveUser,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new HttpError(400, "关联 ID 不合法");
  const row = await getD1()
    .prepare(
      `SELECT id,source_work_id,target_role,target_work_id,vice_versa,created_by_user_id FROM translation_relations WHERE id=?`,
    )
    .bind(id)
    .first<{
      id: number;
      source_work_id: number;
      target_role: TranslationRole;
      target_work_id: number;
      vice_versa: number;
      created_by_user_id: number | null;
    }>();
  if (!row) throw new HttpError(404, "翻译关联不存在");
  if (
    !actor.permissionKeys.includes("translation_relation.manage_any") &&
    (!actor.permissionKeys.includes("translation_relation.delete_own") ||
      row.created_by_user_id !== actor.id)
  )
    throw new HttpError(403, "无权删除此关联");
  await getD1().batch([
    getD1().prepare(`DELETE FROM translation_relations WHERE id=?`).bind(id),
    getD1()
      .prepare(
        `DELETE FROM translation_relations WHERE source_work_id=? AND target_work_id=? AND vice_versa=?`,
      )
      .bind(
        row.target_work_id,
        row.source_work_id,
        row.vice_versa === 0 ? 1 : 0,
      ),
  ]);
}

async function relationById(id: number): Promise<RelationRow | null> {
  return getD1()
    .prepare(
      `SELECT id,from_work_id,to_work_id,relation_type,vice_versa,created_by_user_id
       FROM work_relations WHERE id=?`,
    )
    .bind(id)
    .first<RelationRow>();
}

function translationRoleFromRows(
  workId: number,
  rows: TranslationRoleRow[],
): TranslationRole | null {
  for (const row of rows) {
    if (row.source_work_id !== workId && row.target_work_id !== workId) continue;
    return row.source_work_id === workId
      ? row.target_role === "original"
        ? "translation"
        : "original"
      : row.target_role === "original"
        ? "original"
        : "translation";
  }
  return null;
}

export async function assertTranslationLanguageChangeAllowed(
  workId: number,
  language: string,
): Promise<void> {
  const rows = await getD1()
    .prepare(
      `SELECT w.language
     FROM translation_relations tr
     JOIN works w ON w.id = CASE WHEN tr.source_work_id = ? THEN tr.target_work_id ELSE tr.source_work_id END
     WHERE tr.source_work_id = ? OR tr.target_work_id = ?`,
    )
    .bind(workId, workId, workId)
    .all<{ language: string }>();
  if ((rows.results ?? []).some((row) => row.language === language)) {
    throw new HttpError(400, "更新后的语言会与已有翻译关联相同");
  }
}

async function hasLogicalRelation(
  fromWorkId: number,
  toWorkId: number,
  type: RelationType,
  inverse: RelationType | null,
  ignoreIds: number[] = [],
): Promise<boolean> {
  const clauses = [`(from_work_id=? AND to_work_id=? AND relation_type=?)`];
  const binds: Array<string | number> = [fromWorkId, toWorkId, type];
  if (inverse) {
    clauses.push(`(from_work_id=? AND to_work_id=? AND relation_type=?)`);
    binds.push(toWorkId, fromWorkId, inverse);
  }
  const ignored = ignoreIds.length
    ? ` AND id NOT IN (${ignoreIds.map(() => "?").join(",")})`
    : "";
  binds.push(...ignoreIds);
  return Boolean(
    await getD1()
      .prepare(
        `SELECT 1 FROM work_relations WHERE (${clauses.join(" OR ")})${ignored} LIMIT 1`,
      )
      .bind(...binds)
      .first(),
  );
}

async function assertAccessibleWorks(
  actor: ArchiveUser,
  domain: "relation" | "translation",
  ...ids: number[]
): Promise<void> {
  const placeholders = ids.map(() => "?").join(",");
  const canReadPrivate =
    actor.permissionKeys.includes("work.read_private") ||
    (domain === "relation"
      ? actor.permissionKeys.includes("relation.manage_any")
      : actor.permissionKeys.includes("translation_relation.manage_any"));
  const canReadOwn = actor.permissionKeys.includes("work.update_own");
  const rows = await getD1()
    .prepare(
      `
    SELECT w.id
    FROM works w
    WHERE w.id IN (${placeholders})
      AND w.status <> 'deleted'
      AND (
        w.status = 'published'
        OR ? = 1
        OR (? = 1 AND EXISTS (
          SELECT 1 FROM work_uploaders wu
          WHERE wu.work_id = w.id AND wu.user_id = ?
        ))
      )
  `,
    )
    .bind(...ids, canReadPrivate ? 1 : 0, canReadOwn ? 1 : 0, actor.id)
    .all<{ id: number }>();
  if ((rows.results ?? []).length !== ids.length)
    throw new HttpError(404, "目标游戏不存在");
}
function assertCanCreateWorkRelation(actor: ArchiveUser): void {
  if (
    !actor.permissionKeys.includes("relation.create") &&
    !actor.permissionKeys.includes("relation.manage_any")
  )
    throw new HttpError(403, "无权创建关联");
}
function assertCanCreateTranslationRelation(actor: ArchiveUser): void {
  if (
    !actor.permissionKeys.includes("translation_relation.create") &&
    !actor.permissionKeys.includes("translation_relation.manage_any")
  )
    throw new HttpError(403, "无权创建翻译关联");
}
async function assertCanModifyRelation(
  row: RelationRow,
  actor: ArchiveUser,
  permission: "relation.update_own" | "relation.delete_own",
): Promise<void> {
  if (actor.permissionKeys.includes("relation.manage_any")) return;
  if (
    !actor.permissionKeys.includes(permission) ||
    row.created_by_user_id !== actor.id
  )
    throw new HttpError(403, "无权修改此关联");
}
function assertRelationType(value: string): asserts value is RelationType {
  if (
    ![
      "adaptation",
      "prequel",
      "sequel",
      "same_setting",
      "alternative_setting",
      "alternative_version",
      "character",
      "collaboration",
      "version",
      "main_version",
      "collection",
      "in_collection",
    ].includes(value)
  )
    throw new HttpError(400, "关联类型不合法");
}
function assertPositiveIds(...values: number[]): void {
  if (values.some((value) => !Number.isSafeInteger(value) || value <= 0))
    throw new HttpError(400, "游戏 ID 不合法");
}
function isConstraintError(error: unknown): boolean {
  return /constraint|unique|already exists/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
