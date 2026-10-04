import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { hasPermission, type PermissionKey } from "@/lib/authz/permissions";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { FollowDirection, FollowPage, FollowSummary } from "@/lib/dto/db/user-follows";
import { HttpError } from "@/lib/http";

export async function readFollowSummary(runtime: AppRuntime, userId: number, viewer: ArchiveUser | null): Promise<FollowSummary | null> {
  const row = await getD1(runtime).prepare(`SELECT
    u.status,
    (SELECT COUNT(*) FROM user_follows f JOIN users target ON target.id=f.followed_user_id AND target.status='active' WHERE f.follower_user_id=u.id) AS following_count,
    (SELECT COUNT(*) FROM user_follows f JOIN users actor ON actor.id=f.follower_user_id AND actor.status='active' WHERE f.followed_user_id=u.id) AS follower_count,
    EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=? AND f.followed_user_id=u.id) AS is_following,
    EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=u.id AND f.followed_user_id=?) AS is_followed_by
    FROM users u WHERE u.id=? AND u.status IN ('active','deleted')`).bind(viewer?.id ?? 0, viewer?.id ?? 0, userId)
    .first<{ status: "active" | "deleted"; following_count: number; follower_count: number; is_following: number; is_followed_by: number }>();
  if (!row) throw new HttpError(404, "用户不存在");
  if (row.status === "deleted") return null;
  const other = !!viewer && viewer.id !== userId;
  return { followingCount: row.following_count, followerCount: row.follower_count, isFollowing: row.is_following === 1, isFollowedBy: row.is_followed_by === 1,
    canFollow: other && hasPermission(viewer, "timeline.follow.create"),
    canUnfollow: other && hasPermission(viewer, "timeline.follow.delete_own") };
}

async function assertFollowPermission(runtime: AppRuntime, userId: number, permission: PermissionKey) {
  const allowed = await getD1(runtime).prepare(`SELECT 1 FROM users WHERE id=? AND ${userPermissionSql("users.id", permission)}`).bind(userId).first();
  if (!allowed) throw new HttpError(403, "没有执行此好友操作的权限");
}

export async function setUserFollow(runtime: AppRuntime, actorId: number, targetId: number, following: boolean): Promise<void> {
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(400, "用户编号无效");
  if (actorId === targetId) throw new HttpError(400, "不能把自己加为好友");
  const permission = following ? "timeline.follow.create" : "timeline.follow.delete_own";
  await assertFollowPermission(runtime, actorId, permission);
  const db = getD1(runtime);
  if (following) {
    const [result] = await db.batch([
      db.prepare(`INSERT INTO user_follows(follower_user_id,followed_user_id)
      SELECT actor.id,target.id FROM users actor JOIN users target ON target.id=? AND target.status='active'
      WHERE actor.id=? AND actor.status='active' AND ${userPermissionSql("actor.id", permission)}
      ON CONFLICT(follower_user_id,followed_user_id) DO NOTHING`).bind(targetId, actorId),
      // changes() belongs to the preceding relation insert. A retry cannot send
      // another notice, and a notification failure rolls the relation back.
      db.prepare(`INSERT INTO inbox_items(type,sender_user_id,recipient_user_id,title,body,event_key,metadata_json)
        SELECT 'system_notice',f.follower_user_id,f.followed_user_id,'好友提醒','',?,json_object('friend',
          CASE WHEN EXISTS(SELECT 1 FROM user_follows back WHERE back.follower_user_id=f.followed_user_id AND back.followed_user_id=f.follower_user_id)
            THEN 'returned' ELSE 'added' END)
        FROM user_follows f JOIN users recipient ON recipient.id=f.followed_user_id AND recipient.status='active' AND recipient.notify_friend_additions=1
        WHERE f.follower_user_id=? AND f.followed_user_id=? AND changes()=1
          AND NOT EXISTS(SELECT 1 FROM inbox_items i WHERE i.type='system_notice'
            AND i.sender_user_id=f.follower_user_id AND i.recipient_user_id=f.followed_user_id
            AND json_extract(i.metadata_json,'$.friend')=CASE WHEN EXISTS
              (SELECT 1 FROM user_follows back WHERE back.follower_user_id=f.followed_user_id AND back.followed_user_id=f.follower_user_id)
              THEN 'returned' ELSE 'added' END
            AND NOT EXISTS(SELECT 1 FROM inbox_item_reads r WHERE r.item_id=i.id AND r.user_id=f.followed_user_id))`)
        .bind(`friend:${crypto.randomUUID()}`, actorId, targetId),
      db.prepare(`INSERT INTO inbox_item_reads(item_id,user_id,read_at)
        SELECT i.id,?,CURRENT_TIMESTAMP FROM inbox_items i WHERE i.type='system_notice'
          AND i.sender_user_id=? AND i.recipient_user_id=? AND json_extract(i.metadata_json,'$.friend')='added'
          AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=? AND f.followed_user_id=?)
          AND EXISTS(SELECT 1 FROM users target WHERE target.id=? AND target.status='active')
          AND ${userPermissionSql("?", permission)}
        ON CONFLICT(item_id,user_id) DO NOTHING`).bind(actorId, targetId, actorId, actorId, targetId, targetId, actorId),
    ]);
    if (!result.meta.changes) {
      await assertFollowPermission(runtime, actorId, permission);
      if (!await db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").bind(targetId).first()) throw new HttpError(404, "用户不存在");
    }
  } else {
    const result = await db.prepare(`DELETE FROM user_follows WHERE follower_user_id=? AND followed_user_id=?
      AND ${userPermissionSql("user_follows.follower_user_id", permission)}`).bind(actorId, targetId).run();
    if (!result.meta.changes) await assertFollowPermission(runtime, actorId, permission);
  }
}

export async function listUserFollows(runtime: AppRuntime, userId: number, direction: FollowDirection, cursor?: string | null, limit = 30): Promise<FollowPage> {
  if (direction !== "following" && direction !== "followers") throw new HttpError(400, "好友列表类型无效");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new HttpError(400, "好友列表数量无效");
  if (!await getD1(runtime).prepare("SELECT 1 FROM users WHERE id=? AND status='active' AND profile_show_friends=1").bind(userId).first()) throw new HttpError(404, "好友列表不存在");
  const owner = direction === "following" ? "follower_user_id" : "followed_user_id";
  const other = direction === "following" ? "followed_user_id" : "follower_user_id";
  let position: { at: string; id: number; userId: number; direction: FollowDirection } | null = null;
  if (cursor) {
    try {
      if (cursor.length > 300) throw new Error();
      position = JSON.parse(atob(cursor));
      if (!position || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(position.at) || !Number.isSafeInteger(position.id) || position.id < 1 || position.userId !== userId || position.direction !== direction) throw new Error();
    } catch { throw new HttpError(400, "好友分页位置无效，请返回最新列表"); }
  }
  const args: (number | string)[] = [userId];
  if (position) args.push(position.at, position.id);
  const result = await getD1(runtime).prepare(`SELECT u.id,u.display_name,u.avatar_blob_sha256,f.created_at
    FROM user_follows f JOIN users list_owner ON list_owner.id=f.${owner} AND list_owner.status='active' AND list_owner.profile_show_friends=1
    JOIN users u ON u.id=f.${other} AND u.status='active'
    WHERE f.${owner}=? ${position ? `AND (f.created_at,f.${other})<(?,?)` : ""}
    ORDER BY f.created_at DESC,f.${other} DESC LIMIT ?`).bind(...args, limit + 1)
    .all<{ id: number; display_name: string; avatar_blob_sha256: string | null; created_at: string }>();
  const rows = result.results.slice(0, limit), last = rows.at(-1);
  return { items: rows.map((row) => ({ id: row.id, displayName: row.display_name, avatarBlobSha256: row.avatar_blob_sha256 })),
    nextCursor: result.results.length > limit && last ? btoa(JSON.stringify({ at: last.created_at, id: last.id, userId, direction })) : null };
}
