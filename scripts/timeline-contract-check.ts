import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AppRuntime } from "../app/.server/runtime";
import type { ArchiveUser } from "../lib/dto/db/user-access";
import { findUserById } from "../app/.server/db/users";
import { PERMISSIONS, PERMISSION_CATEGORIES, SYSTEM_ROLE_PERMISSIONS } from "../lib/authz/permissions";
import { TIMELINE_RECORD_KINDS } from "../lib/dto/db/timeline";
import { createTimelineStatus, deleteTimelineEvent, listTimeline, readTimelineSettings, recordFirstWorkPlay, timelineStatement, updateTimelineSettings } from "../app/.server/db/timeline";
import { createComment, deleteComment, setWorkFavorite, updateComment } from "../app/.server/db/work-community";
import { addCatalogItem, createCatalog, deleteCatalog, removeCatalogItem, updateCatalog, updateCatalogItem } from "../app/.server/db/catalogs";
import { readShowcase, saveShowcase } from "../app/.server/db/showcase";
import { mergeWorks } from "../app/.server/db/catalog-maintenance";
import { createExternalWork } from "../app/.server/db/game-library";
import { editForum, publishForum } from "../app/.server/forum/mutations";
import type { ForumRuntime } from "../app/.server/forum/runtime";

// Real migrations and production mutation/query functions. Only the D1/R2/DO
// transports are adapted; no dev seed, network, credentials or shared state.
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"));
const coverHash = "a".repeat(64);
type Bind = string | number | null;
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (name === "0034_timeline.sql") {
      sqlite.exec(`INSERT INTO users(id,external_auth_id,email,display_name,email_verified_at) VALUES
        (1,'timeline-a','a@example.test','Timeline A',CURRENT_TIMESTAMP),
        (2,'timeline-b','b@example.test','Timeline B',CURRENT_TIMESTAMP),
        (3,'timeline-moderator','moderator@example.test','Moderator',CURRENT_TIMESTAMP);
        INSERT INTO user_roles(user_id,role_id) SELECT 3,id FROM roles WHERE key='admin';
        INSERT INTO works(id,original_title,status,engine_family,language) VALUES
          (1,'Legacy','published','other','zh-CN'),(2,'Work two','published','other','zh-CN'),
          (3,'Work three','published','other','zh-CN'),(4,'Work four','published','other','zh-CN'),
          (5,'Work five','published','other','zh-CN');
        INSERT INTO user_work_entries(work_id,user_id,last_played_at) VALUES(1,1,'2020-01-01 00:00:00');`);
    }
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  sqlite.exec(`UPDATE users SET profile_show_timeline=1;
    INSERT INTO creators(id,name,name_key,public_at) VALUES(1,'Creator','creator',CURRENT_TIMESTAMP);
    INSERT INTO characters(id,primary_name,primary_name_key,original_name,original_name_key) VALUES(1,'Character','character','Character','character');
    INSERT INTO blobs(sha256,size_bytes,content_type_hint) VALUES('${coverHash}',${png.length},'image/png');
    INSERT INTO media_assets(id,blob_sha256) VALUES(1,'${coverHash}');
    INSERT INTO work_media_assets(work_id,media_asset_id,role,sort_order) VALUES(2,1,'cover',0),(3,1,'cover',0),(4,1,'cover',0);`);
  class Statement {
    constructor(private sql: string, private values: Bind[] = []) {}
    bind(...values: Bind[]) { return new Statement(this.sql, values); }
    execute() {
      const results = sqlite.prepare(this.sql).all(...this.values);
      const meta = sqlite.prepare("SELECT changes() AS changes,last_insert_rowid() AS last_row_id").get()!;
      return { results, success: true, meta: { changes: Number(meta.changes), last_row_id: Number(meta.last_row_id), rows_read: 0, rows_written: Number(meta.changes) } };
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
    async first(column?: string) { const row = this.execute().results[0]; return column ? row?.[column] ?? null : row ?? null; }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try { const results = statements.map((statement) => statement.execute()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  const pending: Promise<unknown>[] = [];
  const bucket = { async get() { return { size: png.length, arrayBuffer: async () => png.slice().buffer }; } } as unknown as R2Bucket;
  const counter = { async counts() { return {}; }, async initializePlayUsers() {}, async mergeWorks() {} };
  const env = { DB: db, ARCHIVE_BUCKET: bucket, VIEW_STATS: { getByName: () => counter } } as unknown as CloudflareEnv;
  const runtime = { db, bucket, env, memo: new Map(), origin: "https://timeline.example.test",
    request: new Request("https://timeline.example.test/timeline"),
    execution: { waitUntil(value: Promise<unknown>) { pending.push(value); }, passThroughOnException() {} },
  } satisfies AppRuntime;
  const actor = (id: number): ArchiveUser => ({ id, email: `${id}@example.test`, displayName: `Actor ${id}`, status: "active", roleKeys: [], roleNames: [],
    permissionKeys: ["forum.use", "catalog.create", "catalog.update_own", "catalog.reorder_own", "catalog.delete_own", "work.external_create",
      ...(id === 3 ? ["forum.content.moderate_any", "work.merge_any", "relation.delete_any", "translation_relation.delete_any"] : [])],
  } as unknown as ArchiveUser);
  const number = (sql: string, ...values: Bind[]) => Number(Object.values(sqlite.prepare(sql).get(...values)!)[0]);
  const count = (kind?: string) => number(`SELECT COUNT(*) FROM timeline_events${kind ? " WHERE kind=?" : ""}`, ...(kind ? [kind] : []));
  const enable = (id = 1, enabled = true, recordKinds: readonly string[] = TIMELINE_RECORD_KINDS) => updateTimelineSettings(runtime, id, { enabled, recordKinds });
  const page = (userId?: number) => listTimeline(runtime, { actorUserId: userId, limit: 50 });
  const pageAs = async (viewerId: number) => {
    const user = await findUserById(runtime, viewerId);
    const authenticated = { ...runtime, memo: new Map([["auth", Promise.resolve({ user })]]) };
    return listTimeline(authenticated, { viewerId, limit: 50 });
  };
  return { sqlite, db, runtime, actor, number, count, enable, page, pageAs, pending };
}
type Fixture = ReturnType<typeof fixture>;
async function check(name: string, test: (f: Fixture) => Promise<void>) {
  const f = fixture();
  try {
    await test(f);
    await Promise.all(f.pending);
    assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    console.log(`Timeline: ${name} passed`);
  } finally { await Promise.allSettled(f.pending); f.sqlite.close(); }
}

await check("opt-in, legacy first-play markers and settings validation", async (f) => {
  assert.equal((await readTimelineSettings(f.runtime, 1)).enabled, false);
  assert.equal(f.count(), 0);
  assert.equal(f.sqlite.prepare("SELECT first_observed_at FROM user_work_first_plays WHERE user_id=1 AND work_id=1").get()!.first_observed_at, null);
  await f.enable();
  await recordFirstWorkPlay(f.runtime, 1, 1);
  assert.equal(f.count(), 0, "a legacy last-play timestamp must not become a first-play event");
  await assert.rejects(updateTimelineSettings(f.runtime, 1, { enabled: true, recordKinds: ["favorite", "favorite"] }), { status: 400 });
  await assert.rejects(updateTimelineSettings(f.runtime, 1, { enabled: true, recordKinds: ["unknown"] }), { status: 400 });
});

await check("master/category gates, status idempotency, permissions and moderation", async (f) => {
  const input = { body: "Original status", requestKey: "timeline-status-contract-0001" };
  await assert.rejects(createTimelineStatus(f.runtime, 1, input), { status: 409 });
  await f.enable();
  const ids = await Promise.all(Array.from({ length: 4 }, () => createTimelineStatus(f.runtime, 1, input)));
  assert.equal(new Set(ids).size, 1);
  const id = ids[0];
  assert.equal(f.count(), 1);
  await assert.rejects(createTimelineStatus(f.runtime, 1, { ...input, body: "Different retry" }), { status: 409 });
  assert.throws(() => f.sqlite.prepare("UPDATE timeline_events SET body=? WHERE id=?").run("Intrusion", id), /cannot be edited/);
  await assert.rejects(deleteTimelineEvent(f.runtime, id, 2), { status: 404 });
  await f.enable(1, true, []);
  assert.equal((await f.page()).items.length, 1, "category switches do not hide history");
  await createTimelineStatus(f.runtime, 1, { body: "Categories off", requestKey: "timeline-status-contract-0002" });
  await f.enable(1, false);
  assert.equal((await f.page()).items.length, 2, "stopping recording preserves public history");
  assert.equal((await f.page(1)).items.length, 2);
  await setWorkFavorite(f.runtime, 2, 1, true);
  assert.equal(f.count(), 2);
  await f.enable();
  assert.equal((await f.page()).items.some((item) => item.text === "Original status"), true);
  assert.equal(f.count(), 2, "reenabling never backfills off-period actions");
  f.sqlite.exec("INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(1,'timeline.status.create')");
  await assert.rejects(createTimelineStatus(f.runtime, 1, { body: "Blocked", requestKey: "timeline-status-contract-0003" }), { status: 403 });
  await deleteTimelineEvent(f.runtime, id, 3);
  assert.equal(f.number("SELECT COUNT(*) FROM auth_audit_logs WHERE event_type='timeline_moderation'"), 1);
  assert.equal(f.sqlite.prepare("SELECT body FROM timeline_events WHERE id=?").get(id)!.body, null, "explicit removal erases standalone text");
  assert.equal((await f.page()).items.length, 1);
  await deleteTimelineEvent(f.runtime, id, 3);
  assert.equal(f.number("SELECT COUNT(*) FROM auth_audit_logs WHERE event_type='timeline_moderation'"), 1, "moderation retries do not duplicate audit entries");
});

await check("timeline business catalog and built-in role defaults", async (f) => {
  const keys = Object.keys(PERMISSIONS).filter((key) => key.startsWith("timeline."));
  assert.equal(keys.length, 12);
  assert.equal(PERMISSION_CATEGORIES.timeline.label, "时间线");
  for (const key of keys) assert.equal(PERMISSIONS[key as keyof typeof PERMISSIONS].category, "timeline");
  for (const role of ["user", "admin", "super_admin"] as const) {
    const actual = f.sqlite.prepare("SELECT permission_key FROM role_permissions p JOIN roles r ON r.id=p.role_id WHERE r.key=? AND p.permission_key LIKE 'timeline.%' ORDER BY permission_key").all(role).map((row) => row.permission_key);
    assert.deepEqual(actual, SYSTEM_ROLE_PERMISSIONS[role].filter((key) => key.startsWith("timeline.")).sort());
  }
});

await check("recording denial preserves business mutations, history and lifetime play consumption", async (f) => {
  await f.enable();
  const id = await createTimelineStatus(f.runtime, 1, { body: "Retained history", requestKey: "timeline-permission-0001" });
  f.sqlite.exec("INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(1,'timeline.use')");
  await assert.rejects(createTimelineStatus(f.runtime, 1, { body: "Denied", requestKey: "timeline-permission-0002" }), { status: 403 });
  await assert.rejects(createTimelineStatus(f.runtime, 1, { body: "Retained history", requestKey: "timeline-permission-0001" }), { status: 403 }, "idempotent retries still enforce current permissions");
  await setWorkFavorite(f.runtime, 2, 1, true);
  const comment = await createComment(f.runtime, { kind: "work", id: 2 }, 1, "Comment still succeeds", undefined, undefined, "timeline-blocked-comment-01");
  await updateComment(f.runtime, comment.id, 1, "Updated while recording denied");
  const forum = { app: f.runtime, env: f.runtime.env, db: f.db, bucket: f.runtime.bucket } as ForumRuntime;
  await publishForum(forum, f.actor(1), { kind: "topic", title: "Discussion still succeeds", body: "Body", tags: [], requestKey: "timeline-blocked-forum-01" });
  await recordFirstWorkPlay(f.runtime, 3, 1);
  assert.equal(f.count(), 1, "all SQL and trigger-derived events are suppressed without failing business operations");
  assert.equal(f.number("SELECT COUNT(*) FROM comments WHERE id=?", comment.id), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_entries WHERE user_id=1 AND work_id=2 AND favorited_at IS NOT NULL"), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_first_plays WHERE user_id=1 AND work_id=3"), 1);
  assert.equal((await f.page()).items[0].id, id, "permission revocation does not rewrite existing visibility");
  await f.enable(1, false);
  await assert.rejects(f.enable(), { status: 403 });
  f.sqlite.exec("DELETE FROM user_permission_blocks WHERE user_id=1 AND permission_key='timeline.use'");
  await f.enable();
  await recordFirstWorkPlay(f.runtime, 3, 1);
  assert.equal(f.count(), 1, "reenabling permission does not backfill or reset first play");
});

await check("independent own create and deletion permissions match card capabilities", async (f) => {
  await f.enable();
  const id = await createTimelineStatus(f.runtime, 1, { body: "Own status", requestKey: "timeline-independent-0001" });
  await setWorkFavorite(f.runtime, 2, 1, true);
  const eventId = f.number("SELECT id FROM timeline_events WHERE kind='favorite'");
  f.sqlite.exec("INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(1,'forum.use'),(1,'timeline.status.create')");
  await assert.rejects(createTimelineStatus(f.runtime, 1, { body: "No create", requestKey: "timeline-independent-0002" }), { status: 403 });
  assert.equal("canEdit" in (await f.pageAs(1)).items.find((item) => item.id === id)!, false);
  f.sqlite.exec("INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(1,'timeline.status.delete_own')");
  let items = (await f.pageAs(1)).items;
  assert.equal(items.find((item) => item.id === id)!.canDelete, false);
  assert.equal(items.find((item) => item.id === eventId)!.canDelete, true);
  await assert.rejects(deleteTimelineEvent(f.runtime, id, 1), { status: 404 });
  f.sqlite.exec("DELETE FROM user_permission_blocks WHERE user_id=1 AND permission_key IN ('timeline.status.create','timeline.status.delete_own'); INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(1,'timeline.event.delete_own')");
  await createTimelineStatus(f.runtime, 1, { body: "Forum permission is unrelated", requestKey: "timeline-independent-0003" });
  items = (await f.pageAs(1)).items;
  assert.equal(items.find((item) => item.id === id)!.canDelete, true);
  assert.equal(items.find((item) => item.id === eventId)!.canDelete, false);
  await assert.rejects(deleteTimelineEvent(f.runtime, eventId, 1), { status: 404 });
  await f.enable(1, false);
  await deleteTimelineEvent(f.runtime, id, 1);
  assert.equal(f.number("SELECT COUNT(*) FROM timeline_events WHERE id=? AND hidden_at IS NOT NULL", id), 1);
  const spoofed = await listTimeline(f.runtime, { viewerId: 1 });
  assert.ok(spoofed.items.every((item) => !item.canDelete), "caller-supplied viewer id is not authorization");
});

await check("custom role grants, blocks, inactive roles and granular moderation", async (f) => {
  await f.enable();
  const id = await createTimelineStatus(f.runtime, 1, { body: "Moderation target", requestKey: "timeline-custom-0001" });
  await setWorkFavorite(f.runtime, 2, 1, true);
  const eventId = f.number("SELECT id FROM timeline_events WHERE kind='favorite'");
  f.sqlite.exec(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE key='user') AND permission_key LIKE 'timeline.%';
    INSERT INTO roles(key,name,priority,kind) VALUES('timeline_editor','Timeline editor',200,'custom');
    INSERT INTO user_roles(user_id,role_id) SELECT 2,id FROM roles WHERE key='timeline_editor';
    INSERT INTO role_permissions(role_id,permission_key) SELECT id,'timeline.use' FROM roles WHERE key='timeline_editor';
    INSERT INTO role_permissions(role_id,permission_key) SELECT id,'timeline.status.create' FROM roles WHERE key='timeline_editor';
    INSERT INTO role_permissions(role_id,permission_key) SELECT id,'timeline.status.moderate_any' FROM roles WHERE key='timeline_editor';
    INSERT INTO role_permissions(role_id,permission_key) SELECT id,'forum.content.moderate_any' FROM roles WHERE key='timeline_editor';`);
  await assert.rejects(f.enable(), { status: 403 }, "forum.use does not grant timeline.use");
  await f.enable(2);
  await createTimelineStatus(f.runtime, 2, { body: "Custom grant", requestKey: "timeline-custom-0002" });
  let items = (await f.pageAs(2)).items;
  assert.equal(items.find((item) => item.id === id)!.canDelete, true);
  assert.equal(items.find((item) => item.id === eventId)!.canDelete, false);
  await assert.rejects(deleteTimelineEvent(f.runtime, eventId, 2), { status: 404 }, "forum moderation and status moderation do not grant event moderation");
  f.sqlite.exec("INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(2,'timeline.status.moderate_any'),(2,'timeline.status.create')");
  assert.equal((await f.pageAs(2)).items.find((item) => item.id === id)!.canDelete, false);
  await assert.rejects(deleteTimelineEvent(f.runtime, id, 2), { status: 404 });
  await assert.rejects(createTimelineStatus(f.runtime, 2, { body: "Blocked grant", requestKey: "timeline-custom-0003" }), { status: 403 });
  f.sqlite.exec("DELETE FROM user_permission_blocks WHERE user_id=2; UPDATE roles SET status='disabled' WHERE key='timeline_editor'");
  await assert.rejects(f.enable(2), { status: 403 });
  f.sqlite.exec("UPDATE roles SET status='active' WHERE key='timeline_editor'; DELETE FROM role_permissions WHERE permission_key='timeline.status.moderate_any' AND role_id IN (SELECT id FROM roles WHERE key='timeline_editor'); INSERT INTO role_permissions(role_id,permission_key) SELECT id,'timeline.event.moderate_any' FROM roles WHERE key='timeline_editor'");
  items = (await f.pageAs(2)).items;
  assert.equal(items.find((item) => item.id === id)!.canDelete, false);
  assert.equal(items.find((item) => item.id === eventId)!.canDelete, true);
  await assert.rejects(deleteTimelineEvent(f.runtime, id, 2), { status: 404 });
  await deleteTimelineEvent(f.runtime, eventId, 2);
  const audit = f.sqlite.prepare("SELECT user_id,detail_json FROM auth_audit_logs WHERE event_type='timeline_moderation'").get()!;
  assert.equal(audit.user_id, 2);
  assert.equal(JSON.parse(String(audit.detail_json)).targetUserId, 1);
  f.sqlite.exec("UPDATE users SET status='disabled' WHERE id=2");
  await assert.rejects(createTimelineStatus(f.runtime, 2, { body: "Disabled account", requestKey: "timeline-custom-0004" }), { status: 403 });
  await assert.rejects(deleteTimelineEvent(f.runtime, eventId, 2), { status: 404 });
});

await check("favorite transitions, no-op saves, privacy and atomic rollback", async (f) => {
  await f.enable();
  await setWorkFavorite(f.runtime, 2, 1, true, ["one"], "note");
  assert.equal(f.count("favorite"), 1);
  await setWorkFavorite(f.runtime, 2, 1, true, ["one"], "note");
  assert.equal(f.count("favorite"), 1);
  await setWorkFavorite(f.runtime, 2, 1, true, ["two"], "note");
  assert.equal(f.count("favorite"), 1);
  await setWorkFavorite(f.runtime, 2, 1, true, ["two"], "changed");
  assert.equal(f.count("favorite"), 1);
  f.sqlite.exec("UPDATE users SET profile_show_favorites=0 WHERE id=1");
  assert.equal((await f.page()).items.length, 0);
  f.sqlite.exec("UPDATE users SET profile_show_favorites=1 WHERE id=1");
  await setWorkFavorite(f.runtime, 2, 1, false);
  assert.equal(f.count("favorite"), 1);
  assert.equal((await f.page()).items[0].text, "", "cancellation never exposes a deleted note");
  await setWorkFavorite(f.runtime, 2, 1, false);
  assert.equal(f.count("favorite"), 1);
  f.sqlite.exec("CREATE TRIGGER reject_favorite BEFORE INSERT ON user_work_entries WHEN NEW.work_id=3 BEGIN SELECT RAISE(ABORT,'fixture rejection'); END");
  await assert.rejects(setWorkFavorite(f.runtime, 3, 1, true));
  assert.equal(f.count("favorite"), 1, "failed business mutation rolls back its event");
  f.sqlite.exec("DROP TRIGGER reject_favorite; UPDATE works SET status='hidden' WHERE id=2");
  assert.equal((await f.page()).items.length, 0);
});

await check("showcase changes remain outside the timeline", async (f) => {
  await f.enable();
  const entries = [
    { kind: "work" as const, targetId: 2, note: "Work note", portrait: null },
    { kind: "character" as const, targetId: 1, note: "Character note", portrait: null },
    { kind: "creator" as const, targetId: 1, note: "Creator note", portrait: null },
  ];
  await saveShowcase(f.runtime, f.actor(1), { revision: 0, entries });
  assert.equal(f.count("showcase"), 0);
  let revision = (await readShowcase(f.runtime, 1)).revision;
  await saveShowcase(f.runtime, f.actor(1), { revision, entries });
  assert.equal(f.count("showcase"), 0);
  revision = (await readShowcase(f.runtime, 1)).revision;
  await assert.rejects(saveShowcase(f.runtime, f.actor(1), { revision: 0, entries: [] }), { status: 409 });
  await saveShowcase(f.runtime, f.actor(1), { revision, entries: [] });
  assert.equal(f.count("showcase"), 0);
  revision = (await readShowcase(f.runtime, 1)).revision;
  await saveShowcase(f.runtime, f.actor(1), { revision, entries: [] });
  assert.equal(f.count("showcase"), 0);
  f.sqlite.exec("UPDATE users SET profile_show_showcase=0 WHERE id=1");
  assert.equal((await f.page()).items.length, 0);
});

await check("catalog additions only and current source visibility", async (f) => {
  await f.enable();
  const actor = f.actor(1), catalog = await createCatalog(f.runtime, { title: "Catalog" }, actor);
  assert.equal(f.count("catalog"), 1);
  await updateCatalog(f.runtime, catalog.id, { title: "Catalog" }, actor);
  assert.equal(f.count("catalog"), 1);
  await addCatalogItem(f.runtime, catalog.id, 2, "first", actor);
  await addCatalogItem(f.runtime, catalog.id, 2, "first", actor);
  assert.equal(f.count("catalog"), 1);
  await updateCatalogItem(f.runtime, catalog.id, 2, 0, "first", actor);
  assert.equal(f.count("catalog"), 1);
  await updateCatalogItem(f.runtime, catalog.id, 2, 1, "second", actor);
  assert.equal(f.count("catalog"), 1);
  await updateCatalog(f.runtime, catalog.id, { title: "Changed catalog" }, actor);
  assert.equal(f.count("catalog"), 1);
  await removeCatalogItem(f.runtime, catalog.id, 2, actor);
  await removeCatalogItem(f.runtime, catalog.id, 2, actor);
  assert.equal(f.count("catalog"), 1);
  f.sqlite.exec("UPDATE users SET profile_show_catalogs=0 WHERE id=1");
  assert.equal((await f.page()).items.length, 0);
  f.sqlite.exec("UPDATE users SET profile_show_catalogs=1 WHERE id=1");
  await deleteCatalog(f.runtime, catalog.id, actor);
  assert.equal(f.count("catalog"), 1);
  const page = await f.page();
  assert.equal(page.items.length, 0, "deleted catalog hides its former source-dependent activity");
});

await check("work/creator/character main comments and current source visibility", async (f) => {
  await f.enable(); await f.enable(2);
  const targets = [{ kind: "work" as const, id: 2 }, { kind: "creator" as const, id: 1 }, { kind: "character" as const, id: 1 }];
  for (const target of targets) {
    const key = `timeline-comment-${target.kind}-001`;
    const root = await createComment(f.runtime, target, 1, `${target.kind} root`, undefined, undefined, key);
    assert.equal((await createComment(f.runtime, target, 1, `${target.kind} root`, undefined, undefined, key)).id, root.id);
    await createComment(f.runtime, target, 2, `${target.kind} reply`, root.id, undefined, `${key}-reply`);
  }
  assert.equal(f.count("comment"), 3);
  const workRoot = f.number("SELECT id FROM comments WHERE work_id=2 AND root_comment_id IS NULL");
  await updateComment(f.runtime, workRoot, 1, "work root");
  assert.equal(f.count("comment"), 3);
  await updateComment(f.runtime, workRoot, 1, "Changed work comment");
  assert.equal(f.count("comment"), 3);
  f.sqlite.exec("UPDATE works SET status='hidden' WHERE id=2");
  assert.equal((await f.page()).items.length, 2);
  f.sqlite.exec("UPDATE works SET status='published' WHERE id=2; UPDATE users SET profile_show_comments=0 WHERE id=1");
  assert.equal((await f.page()).items.length, 0);
  f.sqlite.exec("UPDATE users SET profile_show_comments=1 WHERE id=1");
  f.sqlite.prepare("UPDATE comments SET status='hidden' WHERE id=?").run(workRoot);
  assert.equal((await f.page()).items.length, 2, "hidden main comments disappear");
  f.sqlite.prepare("UPDATE comments SET status='published' WHERE id=?").run(workRoot);
  await deleteComment(f.runtime, workRoot, 1);
  const items = (await f.page()).items;
  assert.equal(items.length, 2, "only readable main comments remain in the timeline");
  assert.ok(items.every((item) => item.text !== "work reply"));
  assert.ok(items.every((item) => !item.text.includes("Changed work comment")));
});

await check("discussion topics only; replies and edits stay outside timeline", async (f) => {
  await f.enable();
  const ctx = { db: f.db } as ForumRuntime, actor = f.actor(1);
  const topic = await publishForum(ctx, actor, { kind: "topic", title: "Topic", body: "Root", tags: [], requestKey: "timeline-forum-topic-001" });
  const post = await publishForum(ctx, actor, { kind: "post", topicId: topic.target.id, body: "Post", requestKey: "timeline-forum-post-001" });
  await publishForum(ctx, actor, { kind: "comment", postId: post.target.id, body: "Nested", requestKey: "timeline-forum-comment-001" });
  assert.equal(f.count("discussion"), 1);
  const topicRevision = f.sqlite.prepare("SELECT revision FROM forum_topics WHERE id=?").get(topic.target.id)!.revision;
  const rootRevision = f.sqlite.prepare("SELECT revision FROM forum_posts WHERE topic_id=? AND post_number=1").get(topic.target.id)!.revision;
  await editForum(ctx, actor, { target: topic.target, topicRevision, revision: rootRevision, title: "Changed topic", body: "Changed root", tags: [] });
  assert.equal(f.count("discussion"), 1, "editing does not create another activity");
  f.sqlite.prepare("UPDATE forum_topics SET status='hidden' WHERE id=?").run(topic.target.id);
  assert.equal((await f.page()).items.length, 0);
  f.sqlite.prepare("UPDATE forum_topics SET status='published' WHERE id=?").run(topic.target.id);
  f.sqlite.exec("UPDATE users SET profile_show_discussions=0 WHERE id=1");
  assert.equal((await f.page()).items.length, 0);
});

await check("successful external upload and archive visibility/atomic publication", async (f) => {
  await f.enable();
  const input = { user: f.actor(1), originalTitle: "External upload", chineseTitle: null, description: null,
    originalReleaseDate: "2026-01-01", engineFamily: "other", isOriginal: true, isTranslation: false, language: "zh-CN",
    moreInfo: [], aliases: [], tags: [], characters: [], authors: [], translators: [], coverBlobSha256: coverHash,
    previewBlobSha256s: [], downloadUrl: "https://example.test/game.zip" };
  const external = await createExternalWork(f.runtime, input);
  assert.equal(f.count("upload"), 1);
  assert.equal((await f.page()).items[0].target?.href, `/games/${external.workId}`);
  await f.enable(1, false);
  await createExternalWork(f.runtime, { ...input, originalTitle: "Off-period upload" });
  await f.enable();
  assert.equal(f.count("upload"), 1);
  f.sqlite.exec(`INSERT INTO archive_versions(id,work_id,manifest_sha256,file_policy_version,packer_version,source_type,status)
    VALUES(1,2,'${"b".repeat(64)}','fixture','fixture','browser_zip','processing');`);
  const event = () => timelineStatement(f.db, { userId: 1, kind: "upload", action: "上传了新版本", eventKey: "archive-upload:1", workId: 2, archiveVersionId: 1,
    predicate: "EXISTS(SELECT 1 FROM archive_versions WHERE id=1 AND status='published')" });
  await event().run();
  assert.equal(f.count("upload"), 1, "processing rows cannot announce a published archive");
  await assert.rejects(f.db.batch([f.db.prepare("UPDATE archive_versions SET status='published' WHERE id=1"), event(), f.db.prepare("UPDATE works SET original_title=NULL WHERE id=2")]));
  assert.equal(f.count("upload"), 1);
  await f.db.batch([f.db.prepare("UPDATE archive_versions SET status='published' WHERE id=1"), event()]);
  await event().run();
  assert.equal(f.count("upload"), 2);
  f.sqlite.exec("UPDATE archive_versions SET status='hidden' WHERE id=1");
  assert.equal((await f.page()).items.length, 1);
});

await check("first-play off-period consumption, retry races and rollback", async (f) => {
  await recordFirstWorkPlay(f.runtime, 2, 1);
  assert.equal(f.count("play"), 0);
  await f.enable();
  await recordFirstWorkPlay(f.runtime, 2, 1);
  assert.equal(f.count("play"), 0, "reenabling does not regenerate consumed first plays");
  await f.enable(1, false);
  f.sqlite.exec("UPDATE works SET status='hidden' WHERE id=5");
  await recordFirstWorkPlay(f.runtime, 5, 1);
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_first_plays WHERE user_id=1 AND work_id=5"), 1,
    "an installed hidden work still consumes the private launch identity");
  f.sqlite.exec("UPDATE works SET status='published' WHERE id=5");
  await f.enable();
  await recordFirstWorkPlay(f.runtime, 5, 1);
  assert.equal(f.count("play"), 0, "restoring a hidden work cannot create a false first-play replay");
  await Promise.all(Array.from({ length: 8 }, () => recordFirstWorkPlay(f.runtime, 3, 1)));
  assert.equal(f.count("play"), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_first_plays WHERE user_id=1 AND work_id=3"), 1);
  const id = f.number("SELECT id FROM timeline_events WHERE kind='play'");
  await deleteTimelineEvent(f.runtime, id, 1);
  await recordFirstWorkPlay(f.runtime, 3, 1);
  assert.equal(f.count("play"), 1, "removing an event does not reset launch identity");
  f.sqlite.exec("CREATE TRIGGER reject_play BEFORE INSERT ON timeline_events WHEN NEW.kind='play' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END");
  await assert.rejects(recordFirstWorkPlay(f.runtime, 4, 1));
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_first_plays WHERE user_id=1 AND work_id=4"), 0);
  f.sqlite.exec("DROP TRIGGER reject_play");
  await recordFirstWorkPlay(f.runtime, 4, 1);
  assert.equal(f.count("play"), 2);
  f.sqlite.exec("INSERT INTO works(id,original_title,status,engine_family) VALUES(6,'Category-off launch','published','other')");
  await f.enable(1, true, TIMELINE_RECORD_KINDS.filter((kind) => kind !== "play"));
  await recordFirstWorkPlay(f.runtime, 6, 1);
  await f.enable();
  await recordFirstWorkPlay(f.runtime, 6, 1);
  assert.equal(f.count("play"), 2, "per-kind recording-off consumes the same lifetime marker");
  f.sqlite.exec("UPDATE users SET profile_show_history=0 WHERE id=1");
  assert.equal((await f.page()).items.length, 0);
});

await check("work merge preserves launch identity without synthetic user activity", async (f) => {
  await f.enable();
  await recordFirstWorkPlay(f.runtime, 3, 1);
  await recordFirstWorkPlay(f.runtime, 4, 1);
  const earliestPlayId = f.number("SELECT id FROM timeline_events WHERE kind='play' AND work_id=4");
  f.sqlite.exec("UPDATE user_work_first_plays SET first_observed_at='2022-01-01 00:00:00' WHERE work_id=3; UPDATE user_work_first_plays SET first_observed_at='2021-01-01 00:00:00' WHERE work_id=4");
  await setWorkFavorite(f.runtime, 3, 1, true);
  const before = f.count();
  await mergeWorks(f.runtime, f.actor(3), 3, 4);
  await Promise.all(f.pending);
  assert.equal(f.count(), before - 1, "merge only deduplicates the two first-play activities");
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_first_plays WHERE user_id=1 AND work_id IN (3,4)"), 1);
  assert.equal(f.sqlite.prepare("SELECT first_observed_at FROM user_work_first_plays WHERE user_id=1 AND work_id=4").get()!.first_observed_at, "2021-01-01 00:00:00");
  assert.equal(f.number("SELECT COUNT(*) FROM timeline_events WHERE work_id=3"), 0);
  assert.equal(f.number("SELECT id FROM timeline_events WHERE kind='play'"), earliestPlayId,
    "earliest trustworthy marker wins even when its event ID is larger");
  await recordFirstWorkPlay(f.runtime, 4, 1);
  assert.equal(f.count(), before - 1);
  await recordFirstWorkPlay(f.runtime, 2, 1);
  await mergeWorks(f.runtime, f.actor(3), 1, 2);
  await Promise.all(f.pending);
  assert.equal(f.sqlite.prepare("SELECT first_observed_at FROM user_work_first_plays WHERE user_id=1 AND work_id=2").get()!.first_observed_at, null,
    "a legacy prior observation cannot acquire a fabricated exact first time");
  assert.equal(f.number("SELECT COUNT(*) FROM timeline_events WHERE kind='play' AND work_id=2"), 0,
    "an unknown earlier launch suppresses a later duplicate's first-play event");
});

for (const sameSecond of [false, true]) await check(`merging an ${sameSecond ? "equal-second" : "earlier"} off-period launch suppresses false first-play activity`, async (f) => {
  await recordFirstWorkPlay(f.runtime, 3, 1);
  f.sqlite.exec("UPDATE user_work_first_plays SET first_observed_at='2021-01-01 00:00:00' WHERE work_id=3");
  await f.enable();
  await recordFirstWorkPlay(f.runtime, 4, 1);
  f.sqlite.prepare("UPDATE user_work_first_plays SET first_observed_at=? WHERE work_id=4")
    .run(sameSecond ? "2021-01-01 00:00:00" : "2022-01-01 00:00:00");
  assert.equal(f.count("play"), 1);
  await mergeWorks(f.runtime, f.actor(3), 3, 4);
  await Promise.all(f.pending);
  assert.equal(f.count("play"), 0, "the earliest known launch was intentionally unrecorded");
  await recordFirstWorkPlay(f.runtime, 4, 1);
  assert.equal(f.count("play"), 0);
});

await check("stable cursors, deletion, current account privacy and source edits", async (f) => {
  await f.enable();
  const insert = f.sqlite.prepare("INSERT INTO timeline_events(user_id,kind,action,event_key,body,created_at) VALUES(1,'status','发表了吐槽',?,?,'2026-01-01 00:00:00')");
  for (let i = 1; i <= 35; i++) insert.run(`fixture-page:${i}`, `Status ${i}`);
  const first = await listTimeline(f.runtime, { actorUserId: 1, limit: 10 });
  assert.ok(first.nextCursor);
  const boundary = first.items.at(-1)!.id;
  await deleteTimelineEvent(f.runtime, boundary, 1);
  await createTimelineStatus(f.runtime, 1, { body: "New while paging", requestKey: "timeline-pagination-new-001" });
  const second = await listTimeline(f.runtime, { actorUserId: 1, limit: 10, cursor: first.nextCursor });
  assert.ok(second.items.every((item) => item.id < boundary));
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 20);
  await assert.rejects(listTimeline(f.runtime, { actorUserId: 2, cursor: first.nextCursor }), { status: 400 });
  f.sqlite.exec("UPDATE users SET profile_show_timeline=0 WHERE id=1");
  assert.equal((await f.page()).items.length, 0);
  f.sqlite.exec("UPDATE users SET profile_show_timeline=1 WHERE id=1");
  assert.equal((await f.page()).items.length, 35);
});

console.log("Timeline persistent contracts passed");
