import type { ArchiveUser } from "@/lib/dto/db/user-access";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { hashSessionToken } from "../app/.server/auth/session-token";
import { forumLocation } from "../app/.server/forum/location";
import {
  deleteForum,
  editForum,
  moderateForum,
  publishForum,
} from "../app/.server/forum/mutations";
import {
  forumPostPage,
  forumPreviews,
  indexedForumSearch,
  publicCommentPage,
} from "../app/.server/forum/public-queries";
import type { ForumRequestRuntime } from "../app/.server/forum/request";
import { readForumJson, requireForumUser } from "../app/.server/forum/request";
import type { ForumRuntime } from "../app/.server/forum/runtime";
import { userSearchVisibilityStatement } from "../app/.server/forum/search-index";
import {
  ownUserDiscussions,
  publicUserDiscussions,
} from "../app/.server/forum/user-discussions";
import {
  forumSearchPhrase,
  forumSearchTokens,
} from "../lib/forum-search-index";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const name of readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort())
  sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
sqlite.exec(
  "INSERT INTO users(id,external_auth_id,email,display_name,email_verified_at) VALUES(1,'forum-contract','forum-contract@example.test','Fixture',CURRENT_TIMESTAMP)",
);

class Statement {
  constructor(
    private sql: string,
    private values: Array<string | number | null> = [],
  ) {}
  bind(...values: Array<string | number | null>) {
    return new Statement(this.sql, values);
  }
  execute() {
    const results = sqlite.prepare(this.sql).all(...this.values);
    const changes = sqlite.prepare("SELECT changes() AS n").get()!.n;
    return {
      results,
      success: true,
      meta: { changes, rows_read: 0, rows_written: changes },
    };
  }
  async all() {
    return this.execute();
  }
  async run() {
    return this.execute();
  }
  async first(column?: string) {
    const row = this.execute().results[0];
    return column ? (row?.[column] ?? null) : (row ?? null);
  }
}
const db = {
  prepare: (sql: string) => new Statement(sql),
  async batch(statements: Statement[]) {
    sqlite.exec("BEGIN");
    try {
      const result = statements.map((statement) => statement.execute());
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
} as unknown as D1Database;
const ctx = { db } as ForumRuntime;
const actor = {
  id: 1,
  status: "active",
  permissionKeys: [],
  roleKeys: [],
} as unknown as ArchiveUser;
const requestCtx = {
  ...ctx,
  origin: "https://forum.example.test",
} as ForumRequestRuntime;
const token = "a".repeat(43);
sqlite
  .prepare(
    "INSERT INTO user_sessions(user_id,session_hash,expires_at) VALUES(1,?,datetime('now','+1 hour'))",
  )
  .run(await hashSessionToken(token));
const request = (origin = requestCtx.origin) =>
  new Request(`${requestCtx.origin}/api/discussions`, {
    method: "POST",
    headers: { origin, cookie: `viprpg_session=${token}` },
    body: "{}",
  });
assert.equal((await requireForumUser(requestCtx, request())).user.id, 1);
await assert.rejects(
  requireForumUser(requestCtx, request("https://elsewhere.example.test")),
  { status: 403 },
);
await assert.rejects(
  requireForumUser(requestCtx, request(), ["forum.tag.manage"]),
  { status: 403 },
);
sqlite.exec("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP");
await assert.rejects(requireForumUser(requestCtx, request()), { status: 401 });
for (const headers of [
  new Headers(),
  new Headers({ "content-length": String(128 * 1024 + 1) }),
]) {
  await assert.rejects(
    readForumJson(
      new Request(requestCtx.origin, {
        method: "POST",
        headers,
        body: " ".repeat(128 * 1024 + 1),
      }),
    ),
    { status: 413 },
  );
}
await assert.rejects(
  readForumJson(new Request(requestCtx.origin, { method: "POST", body: "[]" })),
  { status: 400 },
);
const topicInput = {
  kind: "topic",
  title: "汉化教程",
  body: "汉化和😀🚀",
  tags: [],
  requestKey: "topic-contract-00001",
};
const created = await publishForum(ctx, actor, topicInput);
const topicId = created.target.id;
const root = sqlite
  .prepare("SELECT * FROM forum_posts WHERE topic_id=? AND post_number=1")
  .get(topicId)!;
assert.deepEqual(await publishForum(ctx, actor, topicInput), created);
assert.equal(
  sqlite.prepare("SELECT COUNT(*) AS n FROM forum_search_documents").get()!.n,
  1,
);
assert.deepEqual(
  sqlite
    .prepare(
      "SELECT rowid FROM forum_search_index WHERE forum_search_index MATCH ?",
    )
    .all(forumSearchPhrase("汉化教"))
    .map((r) => r.rowid),
  [1],
);
assert.equal(
  sqlite
    .prepare(
      "SELECT COUNT(*) AS n FROM forum_search_index WHERE forum_search_index MATCH ?",
    )
    .get(forumSearchPhrase("😀🚀"))!.n,
  1,
);
assert.throws(() => forumSearchPhrase("汉"));
assert.equal(forumSearchTokens("ＡＢ"), forumSearchTokens("ab"));
const search = (query = "汉化", page = 1) =>
  indexedForumSearch(ctx, { query, page, tags: [], featured: false });
assert.equal((await search()).items.length, 1);
assert.equal((await search("汉化", 2)).page, 1);

// Source permissions and derived visibility change atomically; restore preserves IDs.
sqlite.exec(
  "INSERT INTO user_roles(user_id,role_id) SELECT 1,id FROM roles WHERE key='admin'",
);
const moderator = {
  ...actor,
  permissionKeys: ["forum.content.moderate_any"],
} as ArchiveUser;
const moderate = (action: string) =>
  moderateForum(ctx, moderator, {
    target: { kind: "topic", id: topicId },
    action,
    reason: "Contract",
    topicRevision: sqlite
      .prepare("SELECT revision FROM forum_topics WHERE id=?")
      .get(topicId)!.revision,
  });
await moderate("hide");
assert.equal((await search()).items.length, 0);
await moderate("restore");
assert.equal((await search()).items[0].topicId, topicId);
await db.batch([
  db.prepare("UPDATE users SET status='disabled' WHERE id=1"),
  userSearchVisibilityStatement(db, 1),
]);
assert.equal((await search()).items.length, 0);
await db.batch([
  db.prepare("UPDATE users SET status='active' WHERE id=1"),
  userSearchVisibilityStatement(db, 1),
]);
assert.equal((await search()).items.length, 1);
const parentRevision = sqlite
  .prepare("SELECT revision FROM forum_posts WHERE id=?")
  .get(root.id)!.revision;

const commentInput = {
  kind: "comment",
  postId: root.id,
  body: "楼内汉化",
  requestKey: "comment-contract-00001",
};
const comment = await publishForum(ctx, actor, commentInput);
assert.deepEqual(await publishForum(ctx, actor, commentInput), comment);
assert.equal(
  sqlite
    .prepare("SELECT next_comment_number FROM forum_posts WHERE id=?")
    .get(root.id)!.next_comment_number,
  2,
);
assert.equal(
  sqlite
    .prepare("SELECT reply_count FROM forum_topics WHERE id=?")
    .get(topicId)!.reply_count,
  1,
);
assert.equal(
  sqlite.prepare("SELECT revision FROM forum_posts WHERE id=?").get(root.id)!
    .revision,
  parentRevision,
);
await assert.rejects(
  publishForum(ctx, actor, { ...commentInput, body: "Changed payload" }),
);

const beforeFailure = sqlite
  .prepare("SELECT next_comment_number FROM forum_posts WHERE id=?")
  .get(root.id);
const beforeDocuments = sqlite
  .prepare("SELECT COUNT(*) AS n FROM forum_search_documents")
  .get();
// Fail the index statement after source insertion to exercise atomic rollback.
sqlite.exec("DROP TABLE forum_search_index");
await assert.rejects(
  publishForum(ctx, actor, {
    ...commentInput,
    requestKey: "comment-contract-failed",
  }),
);
assert.deepEqual(
  sqlite
    .prepare("SELECT next_comment_number FROM forum_posts WHERE id=?")
    .get(root.id),
  beforeFailure,
);
assert.deepEqual(
  sqlite.prepare("SELECT COUNT(*) AS n FROM forum_search_documents").get(),
  beforeDocuments,
);
assert.equal(
  sqlite.prepare("SELECT COUNT(*) AS n FROM forum_post_comments").get()!.n,
  1,
);
sqlite.exec(
  "CREATE VIRTUAL TABLE forum_search_index USING fts5(title,body,scope)",
);

const row = sqlite
  .prepare("SELECT revision FROM forum_post_comments WHERE id=?")
  .get(comment.target.id)!;
const topicRevision = () =>
  sqlite.prepare("SELECT revision FROM forum_topics WHERE id=?").get(topicId)!
    .revision;
const activity = sqlite
  .prepare("SELECT last_activity_at FROM forum_topics WHERE id=?")
  .get(topicId);
await editForum(ctx, actor, {
  target: comment.target,
  body: "新的正文",
  revision: row.revision,
  topicRevision: topicRevision(),
});
assert.equal(
  sqlite
    .prepare(
      "SELECT COUNT(*) AS n FROM forum_search_index WHERE forum_search_index MATCH ?",
    )
    .get(forumSearchPhrase("正文"))!.n,
  1,
);
assert.deepEqual(
  sqlite
    .prepare("SELECT last_activity_at FROM forum_topics WHERE id=?")
    .get(topicId),
  activity,
);
await deleteForum(ctx, actor, {
  target: comment.target,
  topicRevision: topicRevision(),
});
assert.equal(
  sqlite.prepare("SELECT COUNT(*) AS n FROM forum_search_index").get()!.n,
  0,
);
assert.equal(
  sqlite
    .prepare("SELECT comment_number FROM forum_post_comments WHERE id=?")
    .get(comment.target.id)!.comment_number,
  1,
);
assert.equal(
  sqlite
    .prepare("SELECT reply_count FROM forum_topics WHERE id=?")
    .get(topicId)!.reply_count,
  1,
);
await assert.rejects(
  publishForum(ctx, actor, {
    kind: "post",
    topicId,
    body: "a".repeat(5001),
    requestKey: "post-contract-too-long",
  }),
);
// A missing floor stays in its original numbered page; nested previews stay bounded.
for (let n = 2; n <= 22; n++)
  sqlite
    .prepare(
      `INSERT INTO forum_posts(topic_id,post_number,user_id,body,revision,request_key,request_hash,status)
  VALUES(?,?,1,'fixture','r',?,'h',?)`,
    )
    .run(topicId, n, `fixture-post-${n}`, n === 20 ? "deleted" : "published");
sqlite
  .prepare("UPDATE forum_topics SET next_post_number=23 WHERE id=?")
  .run(topicId);
for (let n = 2; n <= 26; n++)
  sqlite
    .prepare(
      `INSERT INTO forum_post_comments(post_id,user_id,body,revision,request_key,request_hash,comment_number)
  VALUES(?,1,'fixture','r',?,'h',?)`,
    )
    .run(root.id, `fixture-comment-${n}`, n);
sqlite
  .prepare("UPDATE forum_posts SET next_comment_number=27 WHERE id=?")
  .run(root.id);
const page1 = await forumPostPage(ctx, topicId, 1);
const page2 = await forumPostPage(ctx, topicId, 2);
assert.equal(page1.posts.items.length, 20);
assert.equal(page1.posts.items[19].body, null);
assert.deepEqual(
  page2.posts.items.map((p) => p.postNumber),
  [21, 22],
);
assert.equal(page2.posts.total, 22);
const preview = await forumPreviews(ctx, topicId, [Number(root.id)]);
assert.equal(preview[0].comments.total, 26);
assert.equal(preview[0].comments.items.length, 5);
assert.equal(
  (await publicCommentPage(ctx, Number(root.id), 2)).items.length,
  10,
);
const lastComment = Number(
  sqlite
    .prepare(
      "SELECT id FROM forum_post_comments WHERE post_id=? AND comment_number=26",
    )
    .get(root.id)!.id,
);
assert.equal(
  (await forumLocation(ctx, topicId, { commentId: lastComment })).commentPage,
  3,
);
sqlite
  .prepare("UPDATE forum_posts SET status='deleted' WHERE id=?")
  .run(root.id);
assert.equal(
  (await publicCommentPage(ctx, Number(root.id), 3)).items.length,
  6,
);
sqlite
  .prepare("UPDATE forum_posts SET status='hidden' WHERE id=?")
  .run(root.id);
await assert.rejects(publicCommentPage(ctx, Number(root.id), 3));
assert.equal(
  (await forumPreviews(ctx, topicId, [Number(root.id)]))[0].available,
  false,
);

// Concurrent publication observes one topic revision; losers retry explicitly.
sqlite.exec(
  "INSERT INTO users(id,external_auth_id,email,display_name,email_verified_at) VALUES(2,'concurrent-contract','concurrent@example.test','Concurrent',CURRENT_TIMESTAMP)",
);
const concurrentActor = { ...actor, id: 2 };
const concurrentTopic = await publishForum(ctx, concurrentActor, {
  kind: "topic",
  title: "Concurrency",
  body: "Isolated fixture",
  tags: [],
  requestKey: "concurrent-topic-contract",
});
const concurrentRoot = sqlite
  .prepare("SELECT id,revision FROM forum_posts WHERE topic_id=?")
  .get(concurrentTopic.target.id)!;
const inputs = ["a", "b"].map((key) => ({
  kind: "comment",
  postId: concurrentRoot.id,
  body: key,
  requestKey: `concurrent-comment-${key}`,
}));
const attempted = await Promise.allSettled(
  inputs.map((input) => publishForum(ctx, concurrentActor, input)),
);
assert.ok(attempted.some((r) => r.status === "fulfilled"));
for (const [index, result] of attempted.entries())
  if (result.status === "rejected") {
    assert.equal(result.reason.code, "forum_conflict");
    await publishForum(ctx, concurrentActor, inputs[index]);
  }
assert.deepEqual(
  sqlite
    .prepare(
      "SELECT comment_number FROM forum_post_comments WHERE post_id=? ORDER BY comment_number",
    )
    .all(concurrentRoot.id)
    .map((r) => r.comment_number),
  [1, 2],
);
assert.equal(
  sqlite
    .prepare("SELECT reply_count FROM forum_topics WHERE id=?")
    .get(concurrentTopic.target.id)!.reply_count,
  2,
);
assert.equal(
  sqlite
    .prepare("SELECT revision FROM forum_posts WHERE id=?")
    .get(concurrentRoot.id)!.revision,
  concurrentRoot.revision,
);
const revision = sqlite
  .prepare("SELECT revision FROM forum_topics WHERE id=?")
  .get(concurrentTopic.target.id)!.revision;
const editInput = {
  target: concurrentTopic.target,
  body: "Saved body",
  title: "Concurrency",
  tags: [],
  revision: concurrentRoot.revision,
  topicRevision: revision,
};
await editForum(ctx, concurrentActor, editInput);
await assert.rejects(
  editForum(ctx, concurrentActor, { ...editInput, body: "Stale body" }),
  { code: "forum_conflict" },
);
assert.equal(
  sqlite
    .prepare("SELECT body FROM forum_posts WHERE id=?")
    .get(concurrentRoot.id)!.body,
  "Saved body",
);
assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
await verifyDiscussionHistory();
sqlite.close();
console.log(
  "Forum contracts passed: indexing, IDs, idempotency, rollback, numbering, editing and deletion.",
);

async function verifyDiscussionHistory() {
  sqlite.exec(
    "INSERT INTO users(id,external_auth_id,email,display_name,email_verified_at,profile_show_discussions) VALUES(3,'history-contract','history@example.test','History',CURRENT_TIMESTAMP,0)",
  );
  const user = { ...actor, id: 3 };
  assert.equal((await ownUserDiscussions(ctx, user)).total, 0);
  const topic = await publishForum(ctx, user, {
    kind: "topic",
    title: "History fixture",
    body: "Topic body",
    tags: [],
    requestKey: "history-contract-topic",
  });
  const post = await publishForum(ctx, user, {
    kind: "post",
    topicId: topic.target.id,
    body: "Reply body",
    requestKey: "history-contract-post",
  });
  const comment = await publishForum(ctx, user, {
    kind: "comment",
    postId: post.target.id,
    body: "Comment body",
    requestKey: "history-contract-comment",
  });
  sqlite
    .prepare(
      "UPDATE forum_posts SET created_at='2020-01-01 00:00:00' WHERE topic_id=?",
    )
    .run(topic.target.id);
  sqlite
    .prepare(
      "UPDATE forum_post_comments SET created_at='2020-01-02 00:00:00' WHERE id=?",
    )
    .run(comment.target.id);
  const own = await ownUserDiscussions(ctx, user, { pageSize: 2 });
  assert.equal(own.total, 3);
  assert.deepEqual(
    own.items.map((item) => item.kind),
    ["comment", "post"],
  );
  assert.equal(
    own.items[0].href,
    `/discussions/${topic.target.id}/comments/${comment.target.id}`,
  );
  assert.equal(own.items[1].href, `/discussions/${topic.target.id}/posts/2`);
  const last = await ownUserDiscussions(ctx, user, { page: 100, pageSize: 2 });
  assert.equal(last.page, 2);
  assert.equal(last.items[0].kind, "topic");
  assert.equal((await publicUserDiscussions(ctx, user.id)).total, 0);
  sqlite.exec("UPDATE users SET profile_show_discussions=1 WHERE id=3");
  assert.equal((await publicUserDiscussions(ctx, user.id)).total, 3);
  sqlite
    .prepare("UPDATE forum_posts SET status='hidden' WHERE id=?")
    .run(post.target.id);
  assert.equal((await ownUserDiscussions(ctx, user)).total, 1);
  sqlite
    .prepare("UPDATE forum_posts SET status='deleted' WHERE id=?")
    .run(post.target.id);
  assert.equal((await publicUserDiscussions(ctx, user.id)).total, 2);
  sqlite
    .prepare("UPDATE forum_post_comments SET status='deleted' WHERE id=?")
    .run(comment.target.id);
  assert.equal((await publicUserDiscussions(ctx, user.id)).total, 1);
  sqlite.exec("UPDATE users SET status='disabled' WHERE id=3");
  assert.equal(
    (await ownUserDiscussions(ctx, { ...user, status: "disabled" })).total,
    0,
  );
  assert.equal((await publicUserDiscussions(ctx, user.id)).total, 0);
  sqlite.exec("UPDATE users SET status='active' WHERE id=3");
  sqlite
    .prepare("UPDATE forum_topics SET status='hidden' WHERE id=?")
    .run(topic.target.id);
  assert.equal((await ownUserDiscussions(ctx, user)).total, 0);
}
