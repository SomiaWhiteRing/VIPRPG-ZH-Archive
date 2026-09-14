import { contentIndexStatements, searchVisibilityStatement, topicSearchDocuments } from "./search-index";
import type { ForumRuntime } from "./runtime";
import { imageIds, imageOffsets, imageGuard, imageStatements } from "./images";
import { hasPermission, type PermissionKey } from "@/lib/authz/permissions";
import {
  FORUM_BODY_LENGTH,
  FORUM_POST_BODY_LENGTH,
  FORUM_COMMENT_LENGTH,
  FORUM_TITLE_LENGTH,
  FORUM_WRITES_PER_MINUTE,
  FORUM_REPORT_REASONS,
  forumTagError,
  forumTagKey,
  normalizeForumTag,
  type ForumAction,
  type ForumTarget,
} from "@/lib/forum";

import type { ArchiveUser } from "@/lib/server/db/users";
import { HttpError } from "@/lib/server/http/json";
import {
  contentIdentity,
  rawTopic,
  unavailable,
  type ContentRow,
  type TopicRow,
} from "./queries";

type Bind = string | number | null;
type Predicate = { sql: string; args: Bind[] };
export const forumActorSql = (
  permission?: PermissionKey,
) => `EXISTS(SELECT 1 FROM users actor WHERE actor.id=? AND actor.status='active'
  ${
    permission
      ? `AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id
    WHERE ur.user_id=actor.id AND r.status='active' AND rp.permission_key='${permission}')`
      : ""
  })`;
const publicTopicSql = "EXISTS(SELECT 1 FROM forum_public_topics visible WHERE visible.id=t.id)";
const rateSql = `((SELECT COUNT(*) FROM forum_posts WHERE user_id=? AND created_at>=datetime('now','-1 minute'))+
  (SELECT COUNT(*) FROM forum_post_comments WHERE user_id=? AND created_at>=datetime('now','-1 minute'))+
  (SELECT COUNT(*) FROM forum_content_reports WHERE user_id=? AND created_at>=datetime('now','-1 minute'))) < ${FORUM_WRITES_PER_MINUTE}`;
export function forumText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new HttpError(400, `${label}需要 1–${max} 个字符。`);
  return value.trim().replace(/\r\n?/g, "\n");
}
function mixedBody(value: unknown, images: string[], kind: "topic" | "post" | "comment") {
  const limit = kind === "topic" ? FORUM_BODY_LENGTH : kind === "post" ? FORUM_POST_BODY_LENGTH : FORUM_COMMENT_LENGTH;
  if (!images.length)
    return forumText(
      value,
      limit,
      "正文",
    );
  if (
    typeof value !== "string" ||
    value.length > limit ||
    value.includes("\r")
  )
    throw new HttpError(400, "正文长度或换行格式无效。");
  return value;
}
function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new HttpError(400, "目标无效。");
  return value;
}
export function forumTarget(value: unknown): ForumTarget {
  if (!value || typeof value !== "object")
    throw new HttpError(400, "目标无效。");
  const item = value as Record<string, unknown>;
  if (item.kind !== "topic" && item.kind !== "post" && item.kind !== "comment")
    throw new HttpError(400, "目标类型无效。");
  return { kind: item.kind, id: id(item.id) };
}
export function conflict(): never {
  throw new HttpError(
    409,
    "内容或权限已变化。请保留输入，重新载入当前版本后确认。",
    "forum_conflict",
  );
}
export function checkPermission(actor: ArchiveUser, permission: PermissionKey) {
  if (!hasPermission(actor, permission))
    throw new HttpError(403, "没有此操作权限。");
}
async function requestIdentity(input: Record<string, unknown>) {
  if (
    typeof input.requestKey !== "string" ||
    !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestKey)
  )
    throw new HttpError(400, "提交标识无效。");
  const data = new TextEncoder().encode(JSON.stringify(input));
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return { key: input.requestKey, hash };
}
type TagsInput = {
  name: string;
  key: string;
  existingId: number | null;
  revision: string | null;
}[];
async function prepareTags(ctx: ForumRuntime,
  value: unknown,
  topicId?: number,
): Promise<TagsInput> {
  if (!Array.isArray(value) || value.length > 5)
    throw new HttpError(400, "每个主题最多使用 5 个 TAG。");
  const tags: TagsInput = [];
  for (const raw of value) {
    if (typeof raw !== "string") throw new HttpError(400, "TAG 无效。");
    const error = forumTagError(raw);
    if (error) throw new HttpError(400, error);
    const name = normalizeForumTag(raw),
      key = forumTagKey(name);
    if (tags.some((tag) => tag.key === key)) continue;
    const row = await ctx.db
      .prepare(
        `SELECT g.*,EXISTS(SELECT 1 FROM forum_topic_tags x WHERE x.topic_id=? AND x.tag_id=g.id) AS selected FROM forum_tags g WHERE name_key=?`,
      )
      .bind(topicId ?? 0, key)
      .first<{
        id: number;
        name: string;
        status: string;
        revision: string;
        selected: number;
      }>();
    if (
      row &&
      (row.status === "hidden" || (row.status === "disabled" && !row.selected))
    )
      throw new HttpError(
        400,
        "此 TAG 当前不可选用。",
        "forum_tag_unavailable",
      );
    tags.push({
      name: row?.name ?? name,
      key,
      existingId: row?.id ?? null,
      revision: row?.revision ?? null,
    });
  }
  return tags;
}
function tagsPredicate(tags: TagsInput): Predicate {
  const args: Bind[] = [];
  const clauses = tags.map((tag) => {
    args.push(tag.key);
    if (tag.existingId) {
      args.push(tag.revision);
      return "EXISTS(SELECT 1 FROM forum_tags g WHERE g.name_key=? AND g.revision=? AND g.status<>'hidden')";
    }
    return "NOT EXISTS(SELECT 1 FROM forum_tags g WHERE g.name_key=? AND g.status<>'active')";
  });
  return { sql: clauses.join(" AND ") || "1", args };
}
function tagStatements(ctx: ForumRuntime,
  topicId: number | { key: string; userId: number },
  tags: TagsInput,
  actor: ArchiveUser,
  token: string,
): D1PreparedStatement[] {
  const db = ctx.db;
  const target =
    typeof topicId === "number"
      ? { sql: "id=?", args: [topicId] }
      : {
          sql: "request_key=? AND user_id=?",
          args: [topicId.key, topicId.userId],
        };
  const gate = `SELECT id FROM forum_topics WHERE ${target.sql} AND write_token=?`;
  const gateArgs = [...target.args, token];
  const statements: D1PreparedStatement[] = [];
  for (const tag of tags)
    statements.push(
      db
        .prepare(
          `INSERT INTO forum_tags(name,name_key,user_id,revision)
    SELECT ?,?,?,? WHERE EXISTS(${gate}) ON CONFLICT(name_key) DO NOTHING`,
        )
        .bind(tag.name, tag.key, actor.id, crypto.randomUUID(), ...gateArgs),
    );
  statements.push(
    db
      .prepare(`DELETE FROM forum_topic_tags WHERE topic_id IN(${gate})`)
      .bind(...gateArgs),
  );
  tags.forEach((tag, index) =>
    statements.push(
      db
        .prepare(
          `INSERT INTO forum_topic_tags(topic_id,tag_id,position) SELECT t.id,g.id,? FROM forum_topics t,forum_tags g
    WHERE t.id IN(${gate}) AND g.name_key=?`,
        )
        .bind(index, ...gateArgs, tag.key),
    ),
  );
  return statements;
}
function guard(ctx: ForumRuntime,
  topic: TopicRow,
  actor: ArchiveUser,
  token: string,
  predicate: Predicate,
  permission?: PermissionKey,
): D1PreparedStatement {
  return ctx.db
    .prepare(
      `UPDATE forum_topics AS t SET write_token=?,revision=?,updated_at=CURRENT_TIMESTAMP
    WHERE t.id=? AND t.revision=? AND ${forumActorSql(permission)} AND (${predicate.sql})`,
    )
    .bind(
      token,
      token,
      topic.id,
      topic.revision,
      actor.id,
      ...predicate.args,
    );
}
function topicGate(topicId: number, token: string) {
  return {
    sql: "EXISTS(SELECT 1 FROM forum_topics WHERE id=? AND write_token=?)",
    args: [topicId, token],
  };
}
export function auditStatement(ctx: ForumRuntime,
  actor: ArchiveUser,
  event: string,
  target: ForumTarget,
  topicId: number,
  token: string,
  detail: unknown,
): D1PreparedStatement {
  const gate = topicGate(topicId, token);
  return ctx.db
    .prepare(
      `INSERT INTO auth_audit_logs(user_id,event_type,detail_json) SELECT ?,?,? WHERE ${gate.sql}`,
    )
    .bind(
      actor.id,
      `forum_${event}`,
      JSON.stringify({ target, topicId, ...(detail as object) }),
      ...gate.args,
    );
}
async function runGuarded(ctx: ForumRuntime, statements: D1PreparedStatement[]) {
  const result = await ctx.db.batch(statements);
  if (!result[0].meta.changes) conflict();
}
function normalizeTarget(target: ForumTarget, row: ContentRow): ForumTarget {
  return row.kind === "post" && row.post_number === 1
    ? { kind: "topic", id: row.topic_id }
    : target;
}
function currentPublic(row: ContentRow) {
  if (!row.public) unavailable();
}

export async function publishForum(ctx: ForumRuntime,
  actor: ArchiveUser,
  input: Record<string, unknown>,
) {
  const identity = await requestIdentity(input);
  const kind = input.kind;
  if (kind !== "topic" && kind !== "post" && kind !== "comment")
    throw new HttpError(400, "发布类型无效。");
  const table =
    kind === "topic"
      ? "forum_topics"
      : kind === "post"
        ? "forum_posts"
        : "forum_post_comments";
  const existing = await ctx.db
    .prepare(`SELECT * FROM ${table} WHERE user_id=? AND request_key=?`)
    .bind(actor.id, identity.key)
    .first<{
      id: number;
      topic_id: number;
      post_id: number;
      request_hash: string;
    }>();
  if (existing) {
    if (existing.request_hash !== identity.hash) conflict();
    return { target: { kind, id: existing.id } as ForumTarget };
  }
  const count = await ctx.db
    .prepare(`SELECT ${rateSql} AS allowed`)
    .bind(actor.id, actor.id, actor.id)
    .first<{ allowed: number }>();
  if (!count?.allowed) throw new HttpError(429, "操作过于频繁，请稍后再试。");
  const images = imageIds(input.images, kind === "comment");
  const attachments = imageGuard(images, actor.id);
  const body = mixedBody(input.body, images, kind);
  const offsets = imageOffsets(input.imageOffsets ?? [], images, body);
  const token = crypto.randomUUID(),
    db = ctx.db;
  if (kind === "topic") {
    const title = forumText(input.title, FORUM_TITLE_LENGTH, "标题"),
      tags = await prepareTags(ctx, input.tags ?? []),
      tagGuard = tagsPredicate(tags);
    const gate =
      "EXISTS(SELECT 1 FROM forum_topics WHERE user_id=? AND request_key=? AND write_token=?)";
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO forum_topics(user_id,title,revision,write_token,request_key,request_hash)
        SELECT ?,?,?,?,?,? WHERE ${forumActorSql()} AND ${rateSql} AND ${tagGuard.sql} AND ${attachments.sql} ON CONFLICT(user_id,request_key) DO NOTHING`,
        )
        .bind(
          actor.id,
          title,
          token,
          token,
          identity.key,
          identity.hash,
          actor.id,
          actor.id,
          actor.id,
          actor.id,
          ...tagGuard.args,
          ...attachments.args,
        ),
      db
        .prepare(
          `INSERT INTO forum_posts(topic_id,post_number,user_id,body,revision,request_key,request_hash)
        SELECT id,1,?,?,?,?,? FROM forum_topics WHERE user_id=? AND request_key=? AND write_token=?`,
        )
        .bind(
          actor.id,
          body,
          token,
          `root-${identity.key}`,
          identity.hash,
          actor.id,
          identity.key,
          token,
        ),
      ...imageStatements(ctx, images, actor.id, token, offsets),
      ...contentIndexStatements(ctx, "post", actor.id, token, title, body, "insert"),
      db.prepare("UPDATE forum_topics SET last_activity_at=created_at WHERE user_id=? AND request_key=? AND write_token=?").bind(actor.id, identity.key, token),
      ...tagStatements(ctx,
        { key: identity.key, userId: actor.id },
        tags,
        actor,
        token,
      ),
      db
        .prepare(
          `SELECT id,request_hash FROM forum_topics WHERE user_id=? AND request_key=? AND ${gate}`,
        )
        .bind(actor.id, identity.key, actor.id, identity.key, token),
    ]);
    const found = results.at(-1)?.results[0] as { id: number } | undefined;
    if (!found) {
      const retry = await db
        .prepare(
          "SELECT id,request_hash FROM forum_topics WHERE user_id=? AND request_key=?",
        )
        .bind(actor.id, identity.key)
        .first<{ id: number; request_hash: string }>();
      if (retry?.request_hash === identity.hash)
        return { target: { kind, id: retry.id } as ForumTarget };
      conflict();
    }
    return { target: { kind, id: found.id } as ForumTarget };
  }
  const parent = await contentIdentity(ctx,
    kind === "post"
      ? { kind: "topic", id: id(input.topicId) }
      : { kind: "post", id: id(input.postId) },
  );
  currentPublic(parent);
  const topic = await rawTopic(ctx, parent.topic_id);
  if (topic.locked) throw new HttpError(409, "主题已锁定，不能继续回复。");
  const targetId = input.replyToId == null ? null : id(input.replyToId);
  if (kind === "comment" && targetId) {
    const target = await contentIdentity(ctx, { kind: "comment", id: targetId });
    if (!target.public || target.post_id !== parent.id)
      throw new HttpError(409, "回复目标已不可用。", "forum_reply_target");
  }
  const tokenGate = topicGate(topic.id, token);
  const predicate: Predicate = {
    sql: `${publicTopicSql} AND t.locked=0 AND ${rateSql} AND ${attachments.sql} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE user_id=? AND request_key=?)
    ${kind === "comment" ? "AND EXISTS(SELECT 1 FROM forum_public_posts WHERE id=?)" : ""}
    ${kind === "comment" && targetId ? "AND EXISTS(SELECT 1 FROM forum_public_comments WHERE id=? AND post_id=?)" : ""}`,
    args: [
      actor.id,
      actor.id,
      actor.id,
      ...attachments.args,
      actor.id,
      identity.key,
      ...(kind === "comment" ? [parent.id] : []),
      ...(kind === "comment" && targetId ? [targetId, parent.id] : []),
    ],
  };
  const statements = [guard(ctx, topic, actor, token, predicate)];
  if (kind === "post") {
    statements.push(
      db
        .prepare(
          `INSERT INTO forum_posts(topic_id,post_number,user_id,body,revision,request_key,request_hash)
      SELECT id,next_post_number,?,?,?,?,? FROM forum_topics WHERE id=? AND write_token=?`,
        )
        .bind(
          actor.id,
          body,
          token,
          identity.key,
          identity.hash,
          topic.id,
          token,
        ),
    );
    statements.push(
      db
        .prepare(
          "UPDATE forum_topics SET next_post_number=next_post_number+1,reply_count=reply_count+1,last_activity_at=CURRENT_TIMESTAMP,last_post_id=(SELECT id FROM forum_posts WHERE user_id=? AND revision=?),last_comment_id=NULL WHERE id=? AND write_token=?",
        )
        .bind(actor.id, token, topic.id, token),
    );
  } else
    statements.push(
      db
        .prepare(
          `INSERT INTO forum_post_comments(post_id,user_id,reply_to_id,body,revision,request_key,request_hash,comment_number)
    SELECT ?,?,?,?,?,?,?,next_comment_number FROM forum_posts WHERE id=? AND ${tokenGate.sql}`,
        )
        .bind(
          parent.id,
          actor.id,
          targetId,
          body,
          token,
          identity.key,
          identity.hash,
          parent.id,
          ...tokenGate.args,
        ),
    );
  if (kind === "post")
    statements.push(...imageStatements(ctx, images, actor.id, token, offsets));
  if (kind === "comment") statements.push(
    db.prepare(`UPDATE forum_posts SET next_comment_number=next_comment_number+1 WHERE id=? AND ${tokenGate.sql}`).bind(parent.id, ...tokenGate.args),
    db.prepare(`UPDATE forum_topics SET reply_count=reply_count+1,last_activity_at=CURRENT_TIMESTAMP,last_comment_id=(SELECT id FROM forum_post_comments WHERE user_id=? AND revision=?),last_post_id=NULL WHERE id=? AND write_token=?`).bind(actor.id, token, topic.id, token),
  );
  statements.push(...contentIndexStatements(ctx, kind, actor.id, token, "", body, "insert"));
  await db.batch(statements);
  const result = await db
    .prepare(
      `SELECT id,request_hash FROM ${table} WHERE user_id=? AND request_key=?`,
    )
    .bind(actor.id, identity.key)
    .first<{ id: number; request_hash: string }>();
  if (!result || result.request_hash !== identity.hash) conflict();
  return { target: { kind, id: result.id } as ForumTarget };
}

export async function editForum(ctx: ForumRuntime,
  actor: ArchiveUser,
  input: Record<string, unknown>,
) {
  let target = forumTarget(input.target);
  const row = await contentIdentity(ctx, target);
  target = normalizeTarget(target, row);
  currentPublic(row);
  const topic = await rawTopic(ctx, row.topic_id);
  if (input.topicRevision !== topic.revision) conflict();
  if (actor.id !== row.user_id)
    throw new HttpError(403, "只能编辑自己的内容。");
  if (topic.locked) throw new HttpError(409, "主题已锁定，不能编辑。");
  if (row.revision !== input.revision) conflict();
  const images = imageIds(input.images, target.kind === "comment");
  const attachments = imageGuard(images, actor.id, row.id);
  const body = mixedBody(input.body, images, target.kind);
  const offsets = imageOffsets(input.imageOffsets ?? [], images, body);
  const title =
    target.kind === "topic"
      ? forumText(input.title, FORUM_TITLE_LENGTH, "标题")
      : null;
  const tags =
    target.kind === "topic" && input.tagsChanged === true
      ? await prepareTags(ctx, input.tags, topic.id)
      : null;
  const tagGuard = tags ? tagsPredicate(tags) : { sql: "1", args: [] };
  const token = crypto.randomUUID(),
    gate = topicGate(topic.id, token);
  const table =
    target.kind === "comment" ? "forum_post_comments" : "forum_posts";
  const view =
    target.kind === "comment" ? "forum_public_comments" : "forum_public_posts";
  const statements = [
    guard(ctx, topic, actor, token, {
      sql: `${publicTopicSql} AND t.locked=0 AND EXISTS(SELECT 1 FROM ${view} WHERE id=? AND user_id=? AND revision=?) AND ${tagGuard.sql} AND ${attachments.sql}`,
      args: [
        row.id,
        actor.id,
        row.revision,
        ...tagGuard.args,
        ...attachments.args,
      ],
    }),
    ctx.db
      .prepare(
        `UPDATE ${table} SET body=?,revision=?,edited_at=CURRENT_TIMESTAMP WHERE id=? AND ${gate.sql}`,
      )
      .bind(
        body,
        token,
        row.id,
        ...gate.args,
      ),
  ];
  if (title)
    statements.push(
      ctx.db
        .prepare(
          "UPDATE forum_topics SET title=? WHERE id=? AND write_token=?",
        )
        .bind(title, topic.id, token),
    );
  if (tags) statements.push(...tagStatements(ctx, topic.id, tags, actor, token));
  if (target.kind !== "comment")
    statements.push(...imageStatements(ctx, images, actor.id, token, offsets));
  statements.push(...contentIndexStatements(ctx, target.kind === "comment" ? "comment" : "post", actor.id, token, title ?? "", body, "edit"));
  await runGuarded(ctx, statements);
  return { target };
}
export async function deleteForum(ctx: ForumRuntime,
  actor: ArchiveUser,
  input: Record<string, unknown>,
) {
  let target = forumTarget(input.target);
  const row = await contentIdentity(ctx, target);
  target = normalizeTarget(target, row);
  currentPublic(row);
  if (row.user_id !== actor.id)
    throw new HttpError(403, "只能删除自己的内容。");
  const topic = await rawTopic(ctx, row.topic_id);
  if (input.topicRevision !== topic.revision) conflict();
  if (target.kind === "topic" && await ctx.db.prepare("SELECT 1 FROM forum_posts WHERE topic_id=? AND post_number<>1 AND status<>'deleted' UNION ALL SELECT 1 FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id WHERE p.topic_id=? AND c.status<>'deleted' LIMIT 1").bind(topic.id, topic.id).first())
    throw new HttpError(409, "主题已有回复，请请求管理人员处理。");
  const token = crypto.randomUUID(),
    gate = topicGate(topic.id, token),
    table = target.kind === "comment" ? "forum_post_comments" : "forum_posts";
  const predicate: Predicate = {
    sql: `${publicTopicSql} AND EXISTS(SELECT 1 FROM ${target.kind === "comment" ? "forum_public_comments" : "forum_public_posts"} WHERE id=? AND user_id=?)
    ${target.kind === "topic" ? "AND NOT EXISTS(SELECT 1 FROM forum_posts WHERE topic_id=t.id AND post_number<>1 AND status<>'deleted') AND NOT EXISTS(SELECT 1 FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id WHERE p.topic_id=t.id AND c.status<>'deleted')" : ""}`,
    args: [row.id, actor.id],
  };
  const statements = [
    guard(ctx, topic, actor, token, predicate),
    ctx.db
      .prepare(
        `UPDATE ${table} SET status='deleted',body='',revision=? WHERE id=? AND ${gate.sql}`,
      )
      .bind(token, row.id, ...gate.args),
  ];
  if (target.kind === "topic")
    statements.push(
      ctx.db
        .prepare(
          "UPDATE forum_topics SET status='deleted',title='',featured_at=NULL,featured_by=NULL WHERE id=? AND write_token=?",
        )
        .bind(topic.id, token),
    );
  statements.push(...contentIndexStatements(ctx, target.kind === "comment" ? "comment" : "post", actor.id, token, "", "", "delete"));
  await runGuarded(ctx, statements);
}
export async function likeForum(ctx: ForumRuntime,
  actor: ArchiveUser,
  input: Record<string, unknown>,
) {
  const postId = id(input.postId);
  if (typeof input.liked !== "boolean")
    throw new HttpError(400, "点赞状态无效。");
  if (!await ctx.db.prepare("SELECT id FROM forum_public_posts WHERE id=?").bind(postId).first()) unavailable();
  if (input.liked)
    await ctx.db
      .prepare(
        `INSERT OR IGNORE INTO forum_post_likes(post_id,user_id) SELECT id,? FROM forum_public_posts WHERE id=? AND ${forumActorSql()}`,
      )
      .bind(actor.id, postId, actor.id)
      .run();
  else
    await ctx.db
      .prepare(
        `DELETE FROM forum_post_likes WHERE post_id=? AND user_id=? AND ${forumActorSql()} AND EXISTS(SELECT 1 FROM forum_public_posts WHERE id=?)`,
      )
      .bind(postId, actor.id, actor.id, postId)
      .run();
  const fresh = await ctx.db.prepare(`SELECT
    (SELECT COUNT(*) FROM forum_post_likes WHERE post_id=p.id) AS likes,
    EXISTS(SELECT 1 FROM forum_post_likes WHERE post_id=p.id AND user_id=?) AS liked
    FROM forum_public_posts p WHERE p.id=?`).bind(actor.id, postId).first<{likes:number;liked:number}>();
  if (!fresh) unavailable();
  return { liked: !!fresh.liked, likes: fresh.likes };
}
export async function reportForum(ctx: ForumRuntime,
  actor: ArchiveUser,
  input: Record<string, unknown>,
) {
  let target = forumTarget(input.target);
  const row = await contentIdentity(ctx, target);
  target = normalizeTarget(target, row);
  currentPublic(row);
  const existing = await ctx.db
    .prepare(
      "SELECT id FROM forum_content_reports WHERE user_id=? AND target_kind=? AND target_id=? AND status='pending'",
    )
    .bind(actor.id, target.kind, target.id)
    .first<{ id: number }>();
  if (existing) return existing;
  if (
    !FORUM_REPORT_REASONS.includes(
      input.reason as (typeof FORUM_REPORT_REASONS)[number],
    )
  )
    throw new HttpError(400, "请选择举报原因。");
  const explanation =
    typeof input.explanation === "string" ? input.explanation.trim() : "";
  if (explanation.length > 2000 || (input.reason === "其他" && !explanation))
    throw new HttpError(400, "请填写 1–2000 个字符的说明。");
  const view =
    target.kind === "comment" ? "forum_public_comments" : "forum_public_posts";
  await ctx.db
    .prepare(
      `INSERT OR IGNORE INTO forum_content_reports(user_id,topic_id,post_id,comment_id,target_kind,target_id,reason,explanation)
    SELECT ?,?,?,?,?,?,?,? WHERE ${forumActorSql()} AND ${rateSql} AND EXISTS(SELECT 1 FROM ${view} WHERE id=?)`,
    )
    .bind(
      actor.id,
      row.topic_id,
      target.kind === "topic" ? null : row.post_id,
      target.kind === "comment" ? row.id : null,
      target.kind,
      target.id,
      input.reason as string,
      explanation,
      actor.id,
      actor.id,
      actor.id,
      actor.id,
      row.id,
    )
    .run();
  const found = await ctx.db
    .prepare(
      "SELECT id FROM forum_content_reports WHERE user_id=? AND target_kind=? AND target_id=? AND status='pending'",
    )
    .bind(actor.id, target.kind, target.id)
    .first<{ id: number }>();
  if (!found)
    throw new HttpError(429, "提交未完成，请确认目标仍可用后稍后重试。");
  return found;
}

export async function moderateForum(ctx: ForumRuntime,
  actor: ArchiveUser,
  input: Record<string, unknown>,
) {
  let target = forumTarget(input.target);
  const row = await contentIdentity(ctx, target);
  target = normalizeTarget(target, row);
  const action = input.action as ForumAction | "none";
  if (
    ![
      "hide",
      "restore",
      "lock",
      "unlock",
      "feature",
      "unfeature",
      "tags",
      "none",
    ].includes(action)
  )
    throw new HttpError(400, "管理动作无效。");
  const permission: PermissionKey = ["feature", "unfeature", "tags"].includes(
    action,
  )
    ? "forum.topic.feature_any"
    : "forum.content.moderate_any";
  checkPermission(actor, permission);
  const topic = await rawTopic(ctx, row.topic_id);
  if (input.topicRevision !== topic.revision) conflict();
  const reason = forumText(input.reason, 1000, "原因");
  if (action !== "none" && row.status === "deleted")
    throw new HttpError(409, "已删除内容不能修改或恢复。");
  if (
    ["lock", "unlock", "feature", "unfeature", "tags"].includes(action) &&
    target.kind !== "topic"
  )
    throw new HttpError(400, "此动作只适用于主题。");
  if (permission === "forum.topic.feature_any" && !topic.public) unavailable();
  if (action === "restore" && row.status !== "hidden")
    throw new HttpError(409, "目标未被隐藏。");
  const tags =
      action === "tags" ? await prepareTags(ctx, input.tags, topic.id) : null,
    tagGuard = tags ? tagsPredicate(tags) : { sql: "1", args: [] };
  const token = crypto.randomUUID(),
    gate = topicGate(topic.id, token),
    db = ctx.db;
  let report: {
    id: number;
    status: string;
    target_kind: string;
    target_id: number;
  } | null = null;
  if (input.reportId != null) {
    checkPermission(actor, "forum.content.moderate_any");
    report = await db
      .prepare(
        "SELECT id,status,target_kind,target_id FROM forum_content_reports WHERE id=?",
      )
      .bind(id(input.reportId))
      .first();
    if (
      !report ||
      report.status !== "pending" ||
      report.target_kind !== target.kind ||
      report.target_id !== target.id
    )
      conflict();
    if (input.resolution !== "resolved" && input.resolution !== "dismissed")
      throw new HttpError(400, "请选择处理结果。");
  } else if (action === "none") throw new HttpError(400, "缺少管理动作。");
  const restoreImages = action === "restore" && target.kind !== "comment"
    ? {
        sql: `NOT EXISTS(SELECT 1 FROM forum_images i JOIN forum_posts p ON p.id=i.post_id
          WHERE i.status IN('cleanup','cleaned') AND ${target.kind === "topic" ? "p.topic_id=?" : "p.id=?"})`,
        args: [target.kind === "topic" ? topic.id : row.id],
      }
    : { sql: "1", args: [] };
  if (action === "restore" && !await db.prepare(`SELECT 1 AS ok WHERE ${restoreImages.sql}`).bind(...restoreImages.args).first())
    throw new HttpError(409, "关联图片已进入清理，无法完整恢复内容。");
  const predicate: Predicate = {
    sql: `${permission === "forum.topic.feature_any" ? publicTopicSql : "1"} AND ${tagGuard.sql} AND ${restoreImages.sql}
    ${report ? `AND ${forumActorSql("forum.content.moderate_any")} AND EXISTS(SELECT 1 FROM forum_content_reports WHERE id=? AND status='pending')` : ""}`,
    args: [...tagGuard.args, ...restoreImages.args, ...(report ? [actor.id, report.id] : [])],
  };
  const statements = [guard(ctx, topic, actor, token, predicate, permission)];
  if (action === "hide" || action === "restore") {
    const status = action === "hide" ? "hidden" : "published";
    statements.push(
      db
        .prepare(
          `UPDATE ${target.kind === "comment" ? "forum_post_comments" : "forum_posts"} SET status=?,revision=? WHERE id=? AND ${gate.sql}`,
        )
        .bind(status, token, row.id, ...gate.args),
    );
    if (target.kind === "topic")
      statements.push(
        db
          .prepare(
            `UPDATE forum_topics SET status=?,featured_at=NULL,featured_by=NULL WHERE id=? AND write_token=?`,
          )
          .bind(status, topic.id, token),
      );
  } else if (action === "lock" || action === "unlock")
    statements.push(
      db
        .prepare(
          "UPDATE forum_topics SET locked=? WHERE id=? AND write_token=?",
        )
        .bind(action === "lock" ? 1 : 0, topic.id, token),
    );
  else if (action === "feature")
    statements.push(
      db
        .prepare(
          "UPDATE forum_topics SET featured_at=COALESCE(featured_at,CURRENT_TIMESTAMP),featured_by=CASE WHEN featured_at IS NULL THEN ? ELSE featured_by END WHERE id=? AND write_token=?",
        )
        .bind(actor.id, topic.id, token),
    );
  else if (action === "unfeature")
    statements.push(
      db
        .prepare(
          "UPDATE forum_topics SET featured_at=NULL,featured_by=NULL WHERE id=? AND write_token=?",
        )
        .bind(topic.id, token),
    );
  if (tags) statements.push(...tagStatements(ctx, topic.id, tags, actor, token));
  if (report)
    statements.push(
      db
        .prepare(
          `UPDATE forum_content_reports SET status=?,note=?,resolved_by=?,resolved_at=CURRENT_TIMESTAMP WHERE id=? AND ${gate.sql}`,
        )
        .bind(
          input.resolution as string,
          reason,
          actor.id,
          report.id,
          ...gate.args,
        ),
      );
  if (action === "hide" || action === "restore") {
    const selected = target.kind === "topic" ? topic.id : row.id;
    statements.push(searchVisibilityStatement(db, topicSearchDocuments(target.kind),
      target.kind === "comment" ? [selected] : [selected, selected]));
  }
  statements.push(
    auditStatement(ctx, actor, action, target, topic.id, token, {
      reason,
      before: {
        status: row.status,
        locked: topic.locked,
        featured: topic.featured_at,
        tags: topic.tag_snapshot,
      },
      after: { action, tags: tags?.map((t) => t.name) },
      reportId: report?.id,
      resolution: input.resolution,
    }),
  );
  await runGuarded(ctx, statements);
}
