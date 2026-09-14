import { forumSearchTokens } from "@/lib/forum-search-index";
import type { ForumRuntime } from "./runtime";

export const searchPublicSql = `(EXISTS(SELECT 1 FROM forum_public_posts p WHERE p.id=d.post_id)
  OR EXISTS(SELECT 1 FROM forum_public_comments c WHERE c.id=d.comment_id))`;
export const searchScopeSql = `CASE WHEN ${searchPublicSql} THEN 'public' ELSE '' END`;

/** Recheck current visibility inside the same batch as the source mutation. */
export function searchVisibilityStatement(db: D1Database, selection: string, args: (number | string)[]) {
  return db.prepare(`UPDATE forum_search_index SET scope=(
    SELECT ${searchScopeSql} FROM forum_search_documents d WHERE d.id=forum_search_index.rowid
  ) WHERE rowid IN(${selection})`).bind(...args);
}

export function topicSearchDocuments(kind: "topic" | "post" | "comment"): string {
  if (kind === "comment") return "SELECT id FROM forum_search_documents WHERE comment_id=?";
  const posts = `SELECT id FROM forum_posts WHERE ${kind === "topic" ? "topic_id" : "id"}=?`;
  return `SELECT id FROM forum_search_documents WHERE post_id IN(${posts})
    UNION ALL SELECT d.id FROM forum_search_documents d JOIN forum_post_comments c ON c.id=d.comment_id WHERE c.post_id IN(${posts})`;
}

export function userSearchVisibilityStatement(db: D1Database, userId: number) {
  return searchVisibilityStatement(db, `SELECT d.id FROM forum_search_documents d WHERE
    d.post_id IN(SELECT p.id FROM forum_posts p WHERE p.user_id=? OR p.topic_id IN(SELECT id FROM forum_topics WHERE user_id=?))
    OR d.comment_id IN(SELECT c.id FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id
      WHERE c.user_id=? OR p.user_id=? OR p.topic_id IN(SELECT id FROM forum_topics WHERE user_id=?))`,
  [userId,userId,userId,userId,userId]);
}

/** Every statement is gated by the content revision written in this transaction. */
export function contentIndexStatements(
  ctx: ForumRuntime,
  kind: "post" | "comment",
  userId: number,
  revision: string,
  title: string,
  body: string,
  operation: "insert" | "edit" | "delete",
): D1PreparedStatement[] {
  const column = kind === "post" ? "post_id" : "comment_id";
  const table = kind === "post" ? "forum_posts" : "forum_post_comments";
  const source = `SELECT id FROM ${table} WHERE user_id=? AND revision=?`;
  const documents = `SELECT id FROM forum_search_documents WHERE ${column} IN(${source})`;
  const args = [userId, revision];
  const statements: D1PreparedStatement[] = [];
  if (operation === "insert")
    statements.push(ctx.db.prepare(`INSERT INTO forum_search_documents(${column}) ${source}`).bind(...args));
  else
    statements.push(ctx.db.prepare(`DELETE FROM forum_search_index WHERE rowid IN(${documents})`).bind(...args));
  if (operation !== "delete")
    statements.push(ctx.db.prepare(`INSERT INTO forum_search_index(rowid,title,body,scope)
      SELECT d.id,?,?,${searchScopeSql} FROM forum_search_documents d WHERE d.id IN(${documents})`)
      .bind(forumSearchTokens(title), forumSearchTokens(body), ...args));
  return statements;
}
