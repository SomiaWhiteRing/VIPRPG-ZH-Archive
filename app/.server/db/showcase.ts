import {
  CHARACTER_PORTRAIT_COLUMNS,
  DEFAULT_CHARACTER_PORTRAIT_JOINS,
  PUBLIC_CHARACTER_PORTRAIT_CONDITION,
  mapCharacterPortrait,
  type CharacterPortraitRow,
} from "@/app/.server/db/character-portrait-library";
import { getD1 } from "@/app/.server/db/d1";
import {
  registerShowcasePortrait,
  showcasePortraitAvailable,
  SHOWCASE_PORTRAIT_REF_QUERY,
} from "./showcase-portraits";
import type { CharacterPortraitChoice } from "@/lib/character-names";
import type { AppRuntime } from "@/app/.server/runtime";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import {
  isShowcaseKind,
  SHOWCASE_LABELS,
  SHOWCASE_NOTE_LIMIT,
  type ShowcaseEntry,
  type ShowcaseKind,
  type ShowcaseSnapshot,
  type ShowcaseTarget,
} from "@/lib/showcase";

// Both reads and writes use the same public-detail eligibility rules.
const sources = {
  work: {
    from: "public_works w",
    id: "w.id",
    name: "COALESCE(w.chinese_title,w.original_title)",
    columns: `(SELECT ma.blob_sha256 FROM work_media_assets wma
      JOIN media_assets ma ON ma.id=wma.media_asset_id
      WHERE wma.work_id=w.id AND wma.role='cover'
      ORDER BY wma.sort_order,wma.media_asset_id LIMIT 1) AS image_sha256`,
    joins: "",
    visible: "1=1",
    names: ["w.original_title", "w.chinese_title"],
    alias:
      "SELECT 1 FROM work_titles a WHERE a.work_id=w.id AND instr(lower(a.title),lower(?))>0",
  },
  character: {
    from: "characters ch",
    id: "ch.id",
    name: "ch.primary_name",
    columns: `NULL AS image_sha256,${CHARACTER_PORTRAIT_COLUMNS}`,
    joins: `${DEFAULT_CHARACTER_PORTRAIT_JOINS} AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}`,
    visible: "1=1",
    names: ["ch.primary_name", "ch.original_name"],
    alias:
      "SELECT 1 FROM character_aliases a WHERE a.character_id=ch.id AND instr(lower(a.name),lower(?))>0",
  },
  creator: {
    from: "creators c",
    id: "c.id",
    name: "c.name",
    columns: "c.avatar_blob_sha256 AS image_sha256",
    joins: "",
    visible:
      "EXISTS (SELECT 1 FROM work_staff staff JOIN public_works w ON w.id=staff.work_id WHERE staff.creator_id=c.id)",
    names: ["c.name"],
    alias:
      "SELECT 1 FROM creator_aliases a WHERE a.creator_id=c.id AND instr(lower(a.name),lower(?))>0",
  },
} as const;

type TargetRow = CharacterPortraitRow & {
  id: number;
  name: string;
  image_sha256: string | null;
};

export async function findShowcaseTargets(
  runtime: AppRuntime,
  kind: ShowcaseKind,
  input: { query?: string; id?: number },
): Promise<ShowcaseTarget[]> {
  const source = sources[kind];
  const query = input.query?.trim() ?? "";
  if (query.length > 100)
    throw new HttpError(400, "搜索内容不能超过 100 个字符");
  const search = source.names
    .map((name) => `instr(lower(${name}),lower(?))>0`)
    .join(" OR ");
  const rows = await getD1(runtime)
    .prepare(
      `SELECT ${source.id} AS id,${source.name} AS name,${source.columns}
      FROM ${source.from} ${source.joins} WHERE ${source.visible}
      AND (? IS NULL OR ${source.id}=?)
      AND (?='' OR CAST(${source.id} AS TEXT)=? OR ${search} OR EXISTS (${source.alias}))
      ORDER BY CASE WHEN ${source.name}=? THEN 0 ELSE 1 END,${source.name},${source.id} LIMIT 12`,
    )
    .bind(
      input.id ?? null,
      input.id ?? null,
      query,
      query,
      ...source.names.map(() => query),
      query,
      query,
    )
    .all<TargetRow>();
  return rows.results.map((row) => ({
    kind,
    id: row.id,
    name: row.name,
    imageSha256: row.image_sha256,
    portrait: kind === "character" ? mapCharacterPortrait(row) : null,
  }));
}

export async function readShowcase(
  runtime: AppRuntime,
  userId: number,
): Promise<ShowcaseSnapshot> {
  const db = getD1(runtime);
  const [user, rows] = await db.batch([
    db
      .prepare(
        "SELECT showcase_revision AS revision FROM users WHERE id=? AND status='active'",
      )
      .bind(userId),
    db
      .prepare(
        `SELECT e.kind,COALESCE(e.work_id,e.character_id,e.creator_id) AS targetId,e.note,${CHARACTER_PORTRAIT_COLUMNS}
      FROM user_showcase_entries e JOIN users u ON u.id=e.user_id AND u.status='active'
      LEFT JOIN character_portrait_refs portrait_ref ON portrait_ref.id=e.portrait_ref_id AND portrait_ref.character_id=e.character_id
      LEFT JOIN face_sheets portrait_sheet ON portrait_sheet.id=portrait_ref.face_sheet_id
        AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}
        AND EXISTS (SELECT 1 FROM character_face_sheet_bindings binding WHERE binding.character_id=e.character_id AND binding.face_sheet_id=portrait_sheet.id)
      WHERE e.user_id=? ORDER BY e.sort_order`,
      )
      .bind(userId),
  ]);
  const entries: ShowcaseEntry[] = [];
  for (const row of rows.results as Array<
    Pick<ShowcaseEntry, "kind" | "targetId" | "note"> & CharacterPortraitRow
  >) {
    const [target] = await findShowcaseTargets(runtime, row.kind, {
      id: row.targetId,
    });
    const portrait = mapCharacterPortrait(row);
    entries.push({
      kind: row.kind,
      targetId: row.targetId,
      note: row.note,
      portrait: portrait
        ? {
            blobSha256: portrait.blobSha256,
            row: portrait.row,
            column: portrait.column,
          }
        : null,
      target: target
        ? { ...target, portrait: portrait ?? target.portrait }
        : null,
    });
  }
  return {
    revision: Number(
      (user.results[0] as { revision: number } | undefined)?.revision ?? 0,
    ),
    entries,
  };
}

export function parseShowcaseInput(body: Record<string, unknown>): {
  revision: number;
  entries: Array<
    Pick<ShowcaseEntry, "kind" | "targetId" | "note" | "portrait">
  >;
} {
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
    throw new HttpError(400, "展柜版本不合法，请重新读取");
  if (!Array.isArray(body.entries) || body.entries.length > 3)
    throw new HttpError(400, "作品、角色和作者最多各展示一项");
  const seen = new Set<ShowcaseKind>();
  const entries = body.entries.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new HttpError(400, "展柜内容格式不合法");
    const { kind, targetId, note, portrait } = entry as Record<string, unknown>;
    if (!isShowcaseKind(kind) || seen.has(kind))
      throw new HttpError(400, "作品、角色和作者最多各展示一项");
    if (
      typeof targetId !== "number" ||
      !Number.isSafeInteger(targetId) ||
      targetId <= 0
    )
      throw new HttpError(400, "请选择有效的展柜内容");
    if (
      typeof note !== "string" ||
      note.length > SHOWCASE_NOTE_LIMIT ||
      note.includes("\0")
    )
      throw new HttpError(400, `附言不能超过 ${SHOWCASE_NOTE_LIMIT} 个字符`);
    seen.add(kind);
    let choice: CharacterPortraitChoice | null = null;
    if (portrait !== null) {
      if (
        kind !== "character" ||
        !portrait ||
        typeof portrait !== "object" ||
        Array.isArray(portrait)
      )
        throw new HttpError(400, "角色头像选择不合法");
      const { blobSha256, row, column } = portrait as Record<string, unknown>;
      if (
        typeof blobSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(blobSha256) ||
        typeof row !== "number" ||
        !Number.isSafeInteger(row) ||
        row < 0 ||
        row > 3 ||
        typeof column !== "number" ||
        !Number.isSafeInteger(column) ||
        column < 0 ||
        column > 3
      )
        throw new HttpError(400, "角色头像选择不合法");
      choice = { blobSha256, row, column };
    }
    return { kind, targetId, note: note.trim(), portrait: choice };
  });
  return { revision: Number(body.revision), entries };
}

export async function saveShowcase(
  runtime: AppRuntime,
  user: ArchiveUser,
  input: ReturnType<typeof parseShowcaseInput>,
): Promise<void> {
  const db = getD1(runtime);
  for (const entry of input.entries) {
    if (
      !(await findShowcaseTargets(runtime, entry.kind, { id: entry.targetId }))
        .length
    )
      throw new HttpError(
        400,
        `所选${SHOWCASE_LABELS[entry.kind]}已不可公开访问，请重新选择或移除`,
      );
    if (
      entry.portrait &&
      !(await showcasePortraitAvailable(db, entry.targetId, entry.portrait))
    )
      throw new HttpError(400, "所选头像已不可用，请重新选择。");
  }
  try {
    await db.batch([
      // A stale revision aborts the entire batch, including clearing the old items.
      db
        .prepare(
          `UPDATE users SET showcase_revision=CASE
        WHEN showcase_revision=? AND status='active' THEN showcase_revision+1 ELSE NULL END,
        updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        )
        .bind(input.revision, user.id),
      db
        .prepare("DELETE FROM user_showcase_entries WHERE user_id=?")
        .bind(user.id),
      ...input.entries.flatMap((entry) =>
        entry.portrait
          ? [
              registerShowcasePortrait(
                db,
                user.id,
                entry.targetId,
                entry.portrait,
              ),
            ]
          : [],
      ),
      ...input.entries.map((entry, index) => {
        const source = sources[entry.kind];
        // Recheck visibility inside the transaction; the target CHECK rejects NULL.
        return db
          .prepare(
            `INSERT INTO user_showcase_entries(user_id,kind,${entry.kind}_id,sort_order,note,portrait_ref_id)
          VALUES(?,?,(SELECT ${source.id} FROM ${source.from} WHERE ${source.visible} AND ${source.id}=?),?,?,${entry.portrait ? SHOWCASE_PORTRAIT_REF_QUERY : "NULL"})`,
          )
          .bind(
            user.id,
            entry.kind,
            entry.targetId,
            index,
            entry.note,
            ...(entry.portrait
              ? [
                  entry.targetId,
                  entry.portrait.blobSha256,
                  entry.portrait.row,
                  entry.portrait.column,
                ]
              : []),
          );
      }),
      db
        .prepare(
          "INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'showcase_updated')",
        )
        .bind(user.id, user.email),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("users.showcase_revision"))
      throw new HttpError(
        409,
        "展柜已在其他页面更新，当前输入已保留。请重新读取后再编辑。",
        "showcase_conflict",
      );
    if (/CHECK constraint|FOREIGN KEY constraint/i.test(message))
      throw new HttpError(
        409,
        "所选内容的状态已变化，请重新读取后再选择。",
        "showcase_conflict",
      );
    throw error;
  }
}
