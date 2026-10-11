import { workReadByUserSql, workReadCondition } from "@/app/.server/db/work-visibility";
import type { CommentTarget } from "@/lib/comment-target";
import type { ArchiveUser } from "@/lib/dto/db/user-access";

export function commentTargetReadCondition(user: ArchiveUser | null, alias = "c") {
  const work = workReadCondition(user, "comment_work");
  return {
    sql: `(EXISTS(SELECT 1 FROM works comment_work WHERE comment_work.id=${alias}.work_id AND ${work.sql})
      OR EXISTS(SELECT 1 FROM creators cr WHERE cr.id=${alias}.creator_id AND cr.public_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM characters ch WHERE ch.id=${alias}.character_id))`,
    binds: work.binds,
  };
}

export function commentTargetQuery(target: CommentTarget, user: ArchiveUser | null) {
  if (target.kind === "work") {
    const work = workReadCondition(user);
    return { sql: `SELECT id FROM works w WHERE w.id=? AND ${work.sql}`, binds: [target.id, ...work.binds] };
  }
  return {
    sql: target.kind === "creator" ? "SELECT id FROM creators WHERE id=? AND public_at IS NOT NULL"
      : "SELECT id FROM characters WHERE id=?",
    binds: [target.id],
  };
}

/** Use with published_comments, which already checks non-work targets and comment status. */
export function commentRecipientReadSql(alias: string, recipient: string): string {
  return `(${alias}.work_id IS NULL OR EXISTS(SELECT 1 FROM works comment_work
    WHERE comment_work.id=${alias}.work_id AND ${workReadByUserSql(recipient, "comment_work")}))`;
}
