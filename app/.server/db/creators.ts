import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import type {
  ConfirmedCreatorSelection,
  CreatorSelection,
} from "@/lib/creator-names";
import { creatorNameKey, creatorSelectionKey } from "@/lib/creator-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { HttpError } from "@/lib/http";
import { isExtraStaffRole } from "@/lib/staff-credits";

export async function getWorkTranslators(
  runtime: AppRuntime,
  workId: number,
): Promise<ConfirmedCreatorSelection[]> {
  const rows = await getD1(runtime)
    .prepare(
      `SELECT c.id,c.name,ws.display_name FROM work_staff ws
    JOIN creators c ON c.id=ws.creator_id WHERE ws.work_id=? AND ws.role_key='translator' ORDER BY c.id`,
    )
    .bind(workId)
    .all<{ id: number; name: string; display_name: string }>();
  return (rows.results ?? []).map((row) => ({
    kind: "existing",
    creatorId: row.id,
    name: row.name,
    displayName: row.display_name,
  }));
}

export type WorkStaffCreditInput = {
  selection: CreatorSelection;
  roleKey:
    | "author"
    | "scenario"
    | "graphics"
    | "music"
    | "planning"
    | "programming"
    | "translator"
    | "other";
  roleLabel: string | null;
  notes: string | null;
};

export function parseCreatorSelection(value: unknown): CreatorSelection {
  if (!isRecord(value)) {
    throw new HttpError(400, "制作人员选择格式不合法，请重新选择后再提交。");
  }
  const name = normalizeEntityName(stringValue(value.name));
  const displayName = normalizeEntityName(stringValue(value.displayName));
  if (!name || !displayName) {
    throw new HttpError(400, "制作人员名称和本作署名不能为空。");
  }
  if (value.kind === "existing") {
    const creatorId = Number(value.creatorId);
    if (!Number.isSafeInteger(creatorId) || creatorId <= 0) {
      throw new HttpError(400, "制作人员身份不合法，请重新选择后再提交。");
    }
    return { kind: "existing", creatorId, name, displayName };
  }
  if (value.kind === "new") {
    return { kind: "new", name, displayName };
  }
  throw new HttpError(400, "制作人员选择类型不合法，请重新选择后再提交。");
}

export function parseCreatorSelectionJson(
  value: FormDataEntryValue | null,
): CreatorSelection | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return parseCreatorSelection(JSON.parse(value));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "制作人员选择无法读取，请重新选择后再提交。");
  }
}

export function parseTranslatorSelectionsJson(
  value: FormDataEntryValue | null,
): CreatorSelection[] {
  if (typeof value !== "string") throw new HttpError(400, "缺少译者资料。");
  let items: unknown;
  try {
    items = JSON.parse(value);
  } catch {
    throw new HttpError(400, "译者资料无法读取。");
  }
  if (!Array.isArray(items)) throw new HttpError(400, "译者资料必须为列表。");
  return items.map(parseCreatorSelection);
}

export function parseExtraStaffJson(
  value: FormDataEntryValue | null,
): WorkStaffCreditInput[] {
  const credits = parseWorkStaffJson(value);
  if (credits.some((credit) => !isExtraStaffRole(credit.roleKey)))
    throw new HttpError(400, "其他制作人员职务不合法。");
  return credits;
}

export function parseWorkStaffJson(
  value: FormDataEntryValue | null,
): WorkStaffCreditInput[] {
  if (typeof value !== "string") throw new HttpError(400, "缺少制作人员资料。");
  let items: unknown;
  try {
    items = JSON.parse(value);
  } catch {
    throw new HttpError(400, "制作人员资料无法读取。");
  }
  if (!Array.isArray(items))
    throw new HttpError(400, "制作人员资料必须为列表。");
  return items.map((item: unknown) => {
    if (
      !isRecord(item) ||
      !(
        item.roleKey === "author" ||
        item.roleKey === "translator" ||
        isExtraStaffRole(item.roleKey)
      ) ||
      (item.roleLabel !== null && typeof item.roleLabel !== "string") ||
      (item.notes !== null && typeof item.notes !== "string")
    ) {
      throw new HttpError(400, "制作人员职务格式不合法。");
    }
    const roleLabel =
      typeof item.roleLabel === "string" ? item.roleLabel.trim() || null : null;
    if (item.roleKey === "other" && !roleLabel)
      throw new HttpError(400, "请填写其他职务的名称。");
    return {
      selection: parseCreatorSelection(item.selection),
      roleKey: item.roleKey,
      roleLabel,
      notes: typeof item.notes === "string" ? item.notes.trim() || null : null,
    };
  });
}

export async function prepareWorkStaffStatements(input: {
  database: D1Database;
  workId: number;
  credits: WorkStaffCreditInput[];
}): Promise<D1PreparedStatement[]> {
  const credits = input.credits.map((credit) => ({
    ...credit,
    selection: parseCreatorSelection(credit.selection),
    roleLabel: credit.roleLabel?.trim() || null,
    notes: credit.notes?.trim() || null,
  }));
  const resolvedNames = new Map<string, { id: number; name: string } | null>();
  for (const credit of credits) {
    const selection = credit.selection;
    if (selection.kind !== "new") continue;
    const nameKey = creatorNameKey(selection.name);
    if (!resolvedNames.has(nameKey)) {
      resolvedNames.set(
        nameKey,
        await input.database
          .prepare(
            `SELECT id,name FROM creators WHERE name_key=?
          UNION SELECT c.id,c.name FROM creator_aliases ca
          JOIN creators c ON c.id=ca.creator_id WHERE ca.name_key=?`,
          )
          .bind(nameKey, nameKey)
          .first<{ id: number; name: string }>(),
      );
    }
    const existing = resolvedNames.get(nameKey);
    if (existing) {
      credit.selection = {
        kind: "existing",
        creatorId: existing.id,
        name: existing.name,
        displayName: selection.displayName,
      };
    }
  }
  const existingIds = [
    ...new Set(
      credits.flatMap((credit) =>
        credit.selection.kind === "existing"
          ? [credit.selection.creatorId]
          : [],
      ),
    ),
  ];
  const knownIds = new Set<number>();
  if (existingIds.length) {
    const placeholders = existingIds.map(() => "?").join(",");
    const rows = await input.database
      .prepare(`SELECT id FROM creators WHERE id IN (${placeholders})`)
      .bind(...existingIds)
      .all<{ id: number }>();
    for (const row of rows.results ?? []) knownIds.add(row.id);
  }
  const missingId = existingIds.find((id) => !knownIds.has(id));
  if (missingId !== undefined) {
    throw new HttpError(
      409,
      `制作人员 #${missingId} 已不存在，请刷新页面并重新选择。`,
      "creator_selection_stale",
    );
  }

  const statements: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const credit of credits) {
    const identity = creatorSelectionKey(credit.selection);
    const key = `${identity}:${credit.roleKey}`;
    if (seen.has(key))
      throw new HttpError(400, "已有这条署名，请移除重复的制作人员职务。");
    seen.add(key);
    const { selection } = credit;
    if (selection.kind === "existing") {
      statements.push(
        input.database
          .prepare(
            `INSERT INTO work_staff(
               work_id,creator_id,display_name,role_key,role_label,notes
             ) VALUES(?,?,?,?,?,?)`,
          )
          .bind(
            input.workId,
            selection.creatorId,
            selection.displayName,
            credit.roleKey,
            credit.roleLabel,
            credit.notes,
          ),
      );
      continue;
    }

    const nameKey = creatorNameKey(selection.name);

    statements.push(
      input.database
        .prepare(
          `INSERT INTO creators(name,name_key,extra_json)
           SELECT ?,?,'{}' WHERE NOT EXISTS (SELECT 1 FROM creator_aliases WHERE name_key=?)
           ON CONFLICT(name_key) DO NOTHING`,
        )
        .bind(selection.name, nameKey, nameKey),
      input.database
        .prepare(
          `INSERT INTO work_staff(
             work_id,creator_id,display_name,role_key,role_label,notes
           ) SELECT ?,id,?,?,?,? FROM (
             SELECT id FROM creators WHERE name_key=?
             UNION SELECT creator_id AS id FROM creator_aliases WHERE name_key=?
           )`,
        )
        .bind(
          input.workId,
          selection.displayName,
          credit.roleKey,
          credit.roleLabel,
          credit.notes,
          nameKey,
          nameKey,
        ),
    );
  }
  return statements;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
