import { hasPermission } from "@/lib/authz/permissions";
import type {
  AdminForumTag,
  ForumAdminDetail,
  ForumAdminRow,
} from "@/lib/dto/forum/admin";
import type { ForumPage, ForumTarget } from "@/lib/forum";
import {
  FORUM_PAGE_SIZE,
  forumPage,
  forumTagError,
  forumTagKey,
  normalizeForumTag,
} from "@/lib/forum";
import type { ForumRuntime } from "./runtime";

import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import {
  checkPermission,
  conflict,
  forumActorSql,
  forumText,
} from "./mutations";
import {
  contentImages,
  forumViewer,
  mapTopic,
  rawContent,
  rawTopic,
  topicTags,
  unavailable,
} from "./queries";

export async function adminForumList(
  ctx: ForumRuntime,
  actor: ArchiveUser,
  input: { view: string; query?: string; state?: string; page: number },
): Promise<ForumPage<ForumAdminRow>> {
  const moderate = hasPermission(actor, "forum.content.moderate_any");
  if (!moderate) checkPermission(actor, "forum.topic.feature_any");
  if (input.view !== "topics" && !moderate)
    throw new HttpError(403, "没有此视图权限。");
  const query = (input.query ?? "").trim().slice(0, 200),
    state = input.state ?? "";
  let source: string;
  if (input.view === "reports")
    source = `SELECT r.id AS reportId,r.reason,r.explanation,reporter.display_name AS reporter,r.created_at AS createdAt,
    r.target_id AS id,r.target_kind AS kind,r.topic_id AS topicId,COALESCE(p.post_number,1) AS postNumber,t.title,
    COALESCE(c.body,p.body,root.body,'') AS body,COALESCE(c.status,p.status,t.status) AS state,u.display_name AS author
    FROM forum_content_reports r JOIN forum_topics t ON t.id=r.topic_id JOIN users reporter ON reporter.id=r.user_id
    LEFT JOIN forum_posts p ON p.id=r.post_id LEFT JOIN forum_posts root ON root.topic_id=t.id AND root.post_number=1
    LEFT JOIN forum_post_comments c ON c.id=r.comment_id JOIN users u ON u.id=COALESCE(c.user_id,p.user_id,t.user_id) WHERE r.status='pending'`;
  else if (input.view === "posts")
    source = `SELECT p.id,'post' AS kind,p.topic_id AS topicId,p.post_number AS postNumber,t.title,p.body,p.status AS state,u.display_name AS author,p.created_at AS createdAt FROM forum_posts p JOIN forum_topics t ON t.id=p.topic_id JOIN users u ON u.id=p.user_id
    UNION ALL SELECT c.id,'comment',p.topic_id,p.post_number,t.title,c.body,c.status,u.display_name,c.created_at FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id JOIN forum_topics t ON t.id=p.topic_id JOIN users u ON u.id=c.user_id`;
  else
    source = `SELECT t.id,'topic' AS kind,t.id AS topicId,1 AS postNumber,t.title,p.body,t.status AS state,u.display_name AS author,t.updated_at AS createdAt,t.locked,t.featured_at AS featured,
    t.reply_count AS replies,
    (SELECT group_concat(g.name,' / ') FROM forum_topic_tags x JOIN forum_tags g ON g.id=x.tag_id WHERE x.topic_id=t.id AND g.status<>'hidden') AS tags
    FROM ${moderate ? "forum_topics" : "forum_public_topics"} t JOIN forum_posts p ON p.topic_id=t.id AND p.post_number=1 JOIN users u ON u.id=t.user_id`;
  const where = `WHERE (?='' OR instr(lower(title),lower(?))>0 OR instr(lower(body),lower(?))>0 OR instr(lower(author),lower(?))>0 OR CAST(id AS TEXT)=?
    OR EXISTS(SELECT 1 FROM forum_topic_tags x JOIN forum_tags g ON g.id=x.tag_id WHERE x.topic_id=rows.topicId ${moderate ? "" : "AND g.status<>'hidden'"} AND instr(g.name_key,lower(?))>0)) AND (?='' OR state=?)`;
  const args = [query, query, query, query, query, query, state, state];
  const total = (await ctx.db
    .prepare(`WITH rows AS(${source}) SELECT COUNT(*) AS n FROM rows ${where}`)
    .bind(...args)
    .first<{ n: number }>())!.n;
  const page = Math.min(
    forumPage(input.page),
    Math.max(1, Math.ceil(total / FORUM_PAGE_SIZE)),
  );
  const rows = await ctx.db
    .prepare(
      `WITH rows AS(${source}) SELECT * FROM rows ${where} ORDER BY createdAt ${input.view === "reports" ? "ASC" : "DESC"},id LIMIT ? OFFSET ?`,
    )
    .bind(...args, FORUM_PAGE_SIZE, (page - 1) * FORUM_PAGE_SIZE)
    .all<ForumAdminRow>();
  return { items: rows.results, total, page, pageSize: FORUM_PAGE_SIZE };
}
export async function adminForumDetail(
  ctx: ForumRuntime,
  actor: ArchiveUser,
  target: ForumTarget,
): Promise<ForumAdminDetail> {
  const moderate = hasPermission(actor, "forum.content.moderate_any");
  if (!moderate) checkPermission(actor, "forum.topic.feature_any");
  const row = await rawContent(ctx, target),
    topic = await rawTopic(ctx, row.topic_id);
  if (!moderate && (target.kind !== "topic" || !topic.public)) unavailable();
  const tags = await topicTags(ctx, [topic.id]);
  const dto = mapTopic(topic, forumViewer(actor), tags.get(topic.id) ?? []);
  const normalized =
    row.kind === "post" && row.post_number === 1
      ? { kind: "topic" as const, id: topic.id }
      : target;
  // Curators may see that a curation action occurred, but not report notes,
  // resolutions, or historical tag snapshots embedded in the same audit row.
  const auditDetail = moderate
    ? "a.detail_json"
    : "json_object('topicId',json_extract(a.detail_json,'$.topicId'),'action',substr(a.event_type,7))";
  const audit = await ctx.db
    .prepare(
      `SELECT a.id,u.display_name AS actor,a.event_type AS event,${auditDetail} AS detail,a.created_at AS createdAt
    FROM auth_audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.event_type LIKE 'forum_%'
    AND json_extract(a.detail_json,'$.topicId')=? ${moderate ? "" : "AND a.event_type IN('forum_feature','forum_unfeature','forum_tags')"} ORDER BY a.id DESC LIMIT 50`,
    )
    .bind(topic.id)
    .all<ForumAdminDetail["audit"][number]>();
  const parent =
    target.kind === "comment"
      ? await rawContent(ctx, { kind: "post", id: row.post_id })
      : null;
  return {
    target: normalized,
    topicRevision: dto.revision,
    title: topic.title,
    body: row.body,
    images: contentImages(row),
    state: row.status,
    locked: !!topic.locked,
    featured: !!topic.featured_at,
    publicHref: row.public
      ? target.kind === "comment"
        ? `/discussions/${topic.id}/comments/${row.id}`
        : `/discussions/${topic.id}/posts/${row.post_number}`
      : null,
    context: parent
      ? `#${parent.post_number}：${parent.body}`
      : `#${row.post_number}`,
    tags: dto.tags.map((t) => t.name),
    audit: audit.results,
  };
}

export async function adminForumTags(
  ctx: ForumRuntime,
  actor: ArchiveUser,
  input: { query?: string; state?: string; page: number },
): Promise<ForumPage<AdminForumTag>> {
  checkPermission(actor, "forum.tag.manage");
  const query = (input.query ?? "").trim(),
    state = input.state ?? "";
  const where =
    "WHERE (?='' OR instr(g.name_key,?)>0 OR CAST(g.id AS TEXT)=?) AND (?='' OR g.status=?)";
  const args = [query, forumTagKey(query), query, state, state];
  const total = (await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM forum_tags g ${where}`)
    .bind(...args)
    .first<{ n: number }>())!.n;
  const page = Math.min(
    forumPage(input.page),
    Math.max(1, Math.ceil(total / FORUM_PAGE_SIZE)),
  );
  const rows = await ctx.db
    .prepare(
      `SELECT g.id,g.name,g.status AS state,g.revision,u.display_name AS creator,g.updated_at AS updatedAt,
    (SELECT COUNT(*) FROM forum_topic_tags x WHERE x.tag_id=g.id) AS affectedCount,
    (SELECT COUNT(*) FROM forum_topic_tags x JOIN forum_public_topics t ON t.id=x.topic_id WHERE x.tag_id=g.id) AS count
    FROM forum_tags g JOIN users u ON u.id=g.user_id ${where} ORDER BY count DESC,g.id LIMIT ? OFFSET ?`,
    )
    .bind(...args, FORUM_PAGE_SIZE, (page - 1) * FORUM_PAGE_SIZE)
    .all<AdminForumTag>();
  return { items: rows.results, total, page, pageSize: FORUM_PAGE_SIZE };
}
export async function manageForumTag(
  ctx: ForumRuntime,
  actor: ArchiveUser,
  input: Record<string, unknown>,
) {
  checkPermission(actor, "forum.tag.manage");
  const id = Number(input.id);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new HttpError(400, "TAG 无效。");
  const row = await ctx.db
    .prepare("SELECT * FROM forum_tags WHERE id=?")
    .bind(id)
    .first<{
      id: number;
      name: string;
      name_key: string;
      status: string;
      revision: string;
    }>();
  if (!row) unavailable();
  if (row.revision !== input.revision) conflict();
  const reason = forumText(input.reason, 1000, "原因"),
    action = input.action;
  if (
    !["rename", "merge", "disable", "hide", "restore"].includes(String(action))
  )
    throw new HttpError(400, "管理动作无效。");
  let name = row.name,
    key = row.name_key,
    target: { id: number; revision: string; name: string } | null = null;
  if (action === "rename") {
    name = forumText(input.name, 200, "TAG 名称");
    const error = forumTagError(name);
    if (error) throw new HttpError(400, error);
    name = normalizeForumTag(name);
    key = forumTagKey(name);
    if (
      await ctx.db
        .prepare("SELECT id FROM forum_tags WHERE name_key=? AND id<>?")
        .bind(key, id)
        .first()
    )
      throw new HttpError(409, "此名称已被使用，请选择合并。");
  }
  if (action === "merge") {
    target = await ctx.db
      .prepare(
        "SELECT id,revision,name FROM forum_tags WHERE id=? AND status='active' AND id<>?",
      )
      .bind(Number(input.targetId) || 0, id)
      .first();
    if (!target) throw new HttpError(400, "请选择另一个启用的目标 TAG。");
    if (target.revision !== input.targetRevision) conflict();
  }
  const token = crypto.randomUUID(),
    db = ctx.db;
  const guard = "EXISTS(SELECT 1 FROM forum_tags WHERE id=? AND revision=?)";
  const state =
    action === "disable"
      ? "disabled"
      : action === "hide"
        ? "hidden"
        : action === "restore"
          ? "active"
          : row.status;
  const statements = [
    db
      .prepare(
        `UPDATE forum_tags SET revision=?,name=?,name_key=?,status=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND revision=? AND ${forumActorSql("forum.tag.manage")}
    ${target ? "AND EXISTS(SELECT 1 FROM forum_tags WHERE id=? AND revision=? AND status='active')" : ""}
    AND NOT EXISTS(SELECT 1 FROM forum_tags WHERE id<>? AND name_key=?)`,
      )
      .bind(
        token,
        name,
        key,
        state,
        id,
        row.revision,
        actor.id,
        ...(target ? [target.id, target.revision] : []),
        id,
        key,
      ),
  ];
  statements.push(
    db
      .prepare(
        `UPDATE forum_topics SET revision=?,updated_at=CURRENT_TIMESTAMP WHERE id IN(SELECT topic_id FROM forum_topic_tags WHERE tag_id=?) AND ${guard}`,
      )
      .bind(token, id, id, token),
  );
  if (target) {
    // Keep the target's position on duplicate topics; otherwise keep the source position.
    statements.push(
      db
        .prepare(
          `DELETE FROM forum_topic_tags WHERE tag_id=? AND topic_id IN(SELECT topic_id FROM forum_topic_tags WHERE tag_id=?) AND ${guard}`,
        )
        .bind(id, target.id, id, token),
    );
    statements.push(
      db
        .prepare(
          `UPDATE forum_topic_tags SET tag_id=? WHERE tag_id=? AND ${guard}`,
        )
        .bind(target.id, id, id, token),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,event_type,detail_json) SELECT ?,'forum_tag_manage',? WHERE ${guard}`,
      )
      .bind(
        actor.id,
        JSON.stringify({
          tagId: id,
          action,
          reason,
          before: row,
          after: {
            name,
            state,
            targetId: target?.id,
            targetName: target?.name,
          },
        }),
        id,
        token,
      ),
  );
  if (target)
    statements.push(
      db
        .prepare("DELETE FROM forum_tags WHERE id=? AND revision=?")
        .bind(id, token),
    );
  const results = await db.batch(statements);
  if (!results[0].meta.changes) conflict();
}
