import { getD1 } from "@/app/.server/db/d1";
import { normalizeCreatorLinks, parseCreatorLinks } from "@/lib/creator-links";
import type { AppRuntime } from "@/app/.server/runtime";
import { CREATOR_EDIT_LIMITS, creatorMetadataSnapshot, type CreatorMetadata } from "@/lib/creator-edit";
import { creatorNameKey } from "@/lib/creator-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { HttpError } from "@/lib/http";

const PUBLIC_CREATOR_SQL = `EXISTS (SELECT 1 FROM work_staff ws JOIN public_works w ON w.id=ws.work_id WHERE ws.creator_id=creators.id)`;
const EDITOR_PERMISSION_SQL = `EXISTS (SELECT 1 FROM users u
  JOIN effective_user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
  JOIN role_permissions rp ON rp.role_id=r.id
  WHERE u.id=? AND u.status='active' AND r.status='active'
    AND rp.permission_key IN ('creator.metadata.update_public','creator.metadata.update_any'))`;

// The audit entry and all dependent writes share one D1 transaction. Its unique
// edit ID gates every write, so a failed comparison cannot replace aliases.
const EDIT_APPLIED_SQL = `EXISTS (SELECT 1 FROM auth_audit_logs
  WHERE id=(SELECT MAX(id) FROM auth_audit_logs) AND json_extract(detail_json,'$.editId')=?)`;

export async function editPublicCreator(
  runtime: AppRuntime,
  creatorId: number,
  userId: number,
  change: { metadata: CreatorMetadata; snapshot: string } | { avatarBlobSha256: string | null; previousAvatar: string | null },
): Promise<void> {
  const metadata = "metadata" in change ? normalizeMetadata(change.metadata) : null;
  const db = getD1(runtime);
  const editId = crypto.randomUUID();
  const current = await db.prepare(`SELECT name,links_json,extra_json,avatar_blob_sha256,
    (SELECT json_group_array(name) FROM (SELECT name FROM creator_aliases WHERE creator_id=creators.id ORDER BY name)) AS aliases
    FROM creators WHERE id=? AND ${PUBLIC_CREATOR_SQL}`).bind(creatorId).first<{
      name: string; links_json: string; extra_json: string; avatar_blob_sha256: string | null; aliases: string;
    }>();
  if (!current) throw new HttpError(404, "作者不存在或尚未公开");
  const parsed: unknown = JSON.parse(current.extra_json);
  const extra: Record<string, unknown> = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...parsed } : {};
  const before: CreatorMetadata = {
    name: current.name,
    links: parseCreatorLinks(current.links_json),
    bio: typeof extra.bio === "string" && extra.bio.trim() ? extra.bio.trim() : null,
    aliases: JSON.parse(current.aliases) as string[],
  };
  if ("metadata" in change && creatorMetadataSnapshot(before) !== change.snapshot) throw conflict();
  if ("previousAvatar" in change && current.avatar_blob_sha256 !== change.previousAvatar) throw conflict();

  const predicate = metadata
    ? `name=? AND links_json IS ? AND extra_json=? AND (SELECT json_group_array(name) FROM (SELECT name FROM creator_aliases WHERE creator_id=creators.id ORDER BY name))=?`
    : `avatar_blob_sha256 IS ?`;
  const expected = metadata ? [current.name, current.links_json, current.extra_json, current.aliases] : ["previousAvatar" in change ? change.previousAvatar : null];
  const beforeDetail = metadata ? before : { avatarBlobSha256: current.avatar_blob_sha256 };
  const afterDetail = metadata ?? { avatarBlobSha256: "avatarBlobSha256" in change ? change.avatarBlobSha256 : null };
  const statements = [db.prepare(`INSERT INTO auth_audit_logs(user_id,event_type,detail_json)
    SELECT ?,?,? FROM creators WHERE id=? AND ${PUBLIC_CREATOR_SQL} AND ${EDITOR_PERMISSION_SQL} AND ${predicate}`)
    .bind(userId, metadata ? "creator_metadata_update" : "creator_avatar_update", JSON.stringify({ creatorId, editId, before: beforeDetail, after: afterDetail }), creatorId, userId, ...expected)];

  if (metadata) {
    if (metadata.bio) extra.bio = metadata.bio;
    else delete extra.bio;
    statements.push(
      db.prepare(`DELETE FROM creator_aliases WHERE creator_id=? AND ${EDIT_APPLIED_SQL}`).bind(creatorId, editId),
      db.prepare(`UPDATE creators SET name=?,name_key=CASE WHEN EXISTS(SELECT 1 FROM creator_aliases WHERE name_key=? AND creator_id<>?) THEN NULL ELSE ? END,
        links_json=?,extra_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${EDIT_APPLIED_SQL}`)
        .bind(metadata.name, creatorNameKey(metadata.name), creatorId, creatorNameKey(metadata.name), JSON.stringify(metadata.links), JSON.stringify(extra), creatorId, editId),
      db.prepare(`INSERT INTO creator_aliases(creator_id,name,name_key,source)
        SELECT ?,json_extract(a.value,'$.name'),CASE WHEN EXISTS(SELECT 1 FROM creators WHERE name_key=json_extract(a.value,'$.key') AND id<>?) THEN NULL ELSE json_extract(a.value,'$.key') END,'user'
        FROM json_each(?) a WHERE ${EDIT_APPLIED_SQL}`)
        .bind(creatorId, creatorId, JSON.stringify(metadata.aliases.map((name) => ({ name, key: creatorNameKey(name) }))), editId),
    );
  } else if ("avatarBlobSha256" in change) {
    statements.push(db.prepare(`UPDATE creators SET avatar_blob_sha256=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${EDIT_APPLIED_SQL}`).bind(change.avatarBlobSha256, creatorId, editId));
  }
  try {
    const result = await db.batch(statements);
    if (result[0].meta.changes !== 1) throw conflict();
  } catch (error) {
    if (/(?:unique|not null) constraint failed: (?:creators|creator_aliases)\.name_key/i.test(error instanceof Error ? error.message : String(error))) {
      throw new HttpError(409, "名称或别名已被其他作者使用，请核对后修改。", "creator_name_conflict");
    }
    throw error;
  }
}

function normalizeMetadata(input: CreatorMetadata): CreatorMetadata {
  const name = normalizeEntityName(input.name);
  if (!name || name.length > CREATOR_EDIT_LIMITS.name) throw new HttpError(400, `作者名称须为 1–${CREATOR_EDIT_LIMITS.name} 字`);
  const aliases = new Map<string, string>();
  for (const raw of input.aliases) {
    const alias = normalizeEntityName(raw);
    if (alias.length > CREATOR_EDIT_LIMITS.name) throw new HttpError(400, `每个别名最多 ${CREATOR_EDIT_LIMITS.name} 字`);
    const key = creatorNameKey(alias);
    if (alias && key !== creatorNameKey(name) && !aliases.has(key)) aliases.set(key, alias);
  }
  const bio = input.bio?.trim() || null;
  if ((bio?.length ?? 0) > CREATOR_EDIT_LIMITS.bio) throw new HttpError(400, `简介最多 ${CREATOR_EDIT_LIMITS.bio} 字`);
  return { name, aliases: [...aliases.values()], links: normalizeCreatorLinks(input.links), bio };
}

function conflict() {
  return new HttpError(409, "作者资料已被其他人修改。你的输入已保留，请打开最新资料核对后重新编辑。", "creator_edit_conflict");
}
