import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AppRuntime } from "../app/.server/runtime";
import type { ArchiveUser } from "../lib/dto/db/user-access";
import { createOrActivateVerifiedUser, findPublicUserById, findUserById, updateOwnProfile } from "../app/.server/db/users";
import { hasProfileOverviewSections } from "../lib/user-profile";
import { listUserFollows, readFollowSummary, setUserFollow } from "../app/.server/db/user-follows";
import { createTimelineReply, deleteTimelineReply, listTimelineReplies, setTimelineLike } from "../app/.server/db/timeline-interactions";
import { readCommentImage } from "../app/.server/comments/images";
import { cleanupCommentImages } from "../app/.server/comments/image-cleanup";
import { POST as savePrivacy } from "../app/.server/endpoints/api/account/privacy/route";
import { timelineApi } from "../app/.server/timeline/api";
import { jsonError } from "../lib/http";
import { Hono } from "hono";
import { PERMISSIONS, PERMISSION_CATEGORIES, SYSTEM_ROLE_PERMISSIONS } from "../lib/authz/permissions";
import { TIMELINE_RECORD_KINDS } from "../lib/dto/db/timeline";
import { createTimelineStatus, deleteTimelineEvent, listTimeline, readTimelineSettings, timelineStatement, updateTimelineSettings } from "../app/.server/db/timeline";
import { createComment, deleteComment, recordWorkPlayed, setWorkFavorite, updateComment } from "../app/.server/db/work-community";
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
function fixture(preserveDefaults = false, beforeAccountHistory?: (db: DatabaseSync) => void) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (name === "0034_timeline.sql") {
      sqlite.exec(`INSERT INTO users(id,external_auth_id,email,display_name,email_verified_at) VALUES
        (1,'timeline-a','a@example.test','Timeline A',CURRENT_TIMESTAMP),
        (2,'timeline-b','b@example.test','Timeline B',CURRENT_TIMESTAMP),
        (3,'timeline-moderator','moderator@example.test','Moderator',CURRENT_TIMESTAMP),
        (4,'timeline-private','private@example.test','Private legacy user',CURRENT_TIMESTAMP),
        (5,'timeline-deleted','deleted@example.test','Deleted legacy user',CURRENT_TIMESTAMP);
        UPDATE users SET profile_show_bio=0,profile_show_showcase=0,profile_show_favorites=0,
          profile_show_history=0,profile_show_catalogs=0,profile_show_comments=0,profile_show_discussions=0 WHERE id IN (4,5);
        UPDATE users SET status='deleted' WHERE id=5;
        UPDATE users SET created_at='2019-01-01 00:00:00';
        INSERT INTO user_roles(user_id,role_id) SELECT 3,id FROM roles WHERE key='admin';
        INSERT INTO works(id,original_title,status,engine_family,language) VALUES
          (1,'Legacy','published','other','zh-CN'),(2,'Work two','published','other','zh-CN'),
          (3,'Work three','published','other','zh-CN'),(4,'Work four','published','other','zh-CN'),
          (5,'Work five','published','other','zh-CN');
        INSERT INTO user_work_entries(work_id,user_id,last_played_at) VALUES(1,1,'2020-01-01 00:00:00');`);
    }
    if (name === "0036_timeline_account_history.sql") beforeAccountHistory?.(sqlite);
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  if (!preserveDefaults) sqlite.exec("UPDATE users SET timeline_enabled=0");
  sqlite.exec(`INSERT INTO creators(id,name,name_key,public_at) VALUES(1,'Creator','creator',CURRENT_TIMESTAMP);
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
  const deletedObjects: string[] = [];
  const bucket = {
    async get() { return { size: png.length, body: new Response(png.slice()).body!, arrayBuffer: async () => png.slice().buffer }; },
    async delete(key: string) { deletedObjects.push(key); },
  } as unknown as R2Bucket;
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
  // Existing activity contracts exclude the independent account-history baseline.
  const count = (kind?: string) => number(`SELECT COUNT(*) FROM timeline_events WHERE ${kind ? "kind=?" : "kind NOT IN ('join','rename')"}`, ...(kind ? [kind] : []));
  const enable = (id = 1, enabled = true, recordKinds: readonly string[] = TIMELINE_RECORD_KINDS) => updateTimelineSettings(runtime, id, { enabled, recordKinds });
  const activities = (page: Awaited<ReturnType<typeof listTimeline>>) => ({ ...page, items: page.items.filter((item) => item.kind !== "join" && item.kind !== "rename") });
  const page = async (userId?: number) => activities(await listTimeline(runtime, { actorUserId: userId, limit: 50 }));
  const asUser = async (viewerId: number) => {
    const user = await findUserById(runtime, viewerId);
    assert.ok(user);
    return { ...runtime, memo: new Map([["auth", Promise.resolve({ user })]]) };
  };
  const pageAs = async (viewerId: number) => activities(await listTimeline(await asUser(viewerId), { viewerId, limit: 50 }));
  const image = (userId = 1) => {
    const id = crypto.randomUUID();
    sqlite.prepare(`INSERT INTO comment_images(id,user_id,client_id,fingerprint,status,object_key,format,size,width,height)
      VALUES(?,?,?,?,'ready',?,'png',?,1,1)`).run(id, userId, crypto.randomUUID(), coverHash, `comment-images/${id}`, png.length);
    return id;
  };
  return { sqlite, db, runtime, actor, number, count, enable, page, pageAs, asUser, image, deletedObjects, pending };
}
type Fixture = ReturnType<typeof fixture>;
async function check(name: string, test: (f: Fixture) => Promise<void>, preserveDefaults = false, beforeAccountHistory?: (db: DatabaseSync) => void) {
  const f = fixture(preserveDefaults, beforeAccountHistory);
  try {
    await test(f);
    await Promise.all(f.pending);
    assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    console.log(`Timeline: ${name} passed`);
  } finally { await Promise.allSettled(f.pending); f.sqlite.close(); }
}

await check("recording switch, legacy first-play markers and settings validation", async (f) => {
  assert.equal((await readTimelineSettings(f.runtime, 1)).enabled, false);
  assert.equal(f.count(), 0);
  assert.equal(f.sqlite.prepare("SELECT first_observed_at FROM user_work_first_plays WHERE user_id=1 AND work_id=1").get()!.first_observed_at, null);
  await f.enable();
  await recordWorkPlayed(f.runtime, 1, 1);
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
  await recordWorkPlayed(f.runtime, 3, 1);
  assert.equal(f.count(), 1, "all SQL and trigger-derived events are suppressed without failing business operations");
  assert.equal(f.number("SELECT COUNT(*) FROM comments WHERE id=?", comment.id), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_entries WHERE user_id=1 AND work_id=2 AND favorited_at IS NOT NULL"), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_first_plays WHERE user_id=1 AND work_id=3"), 1);
  assert.equal((await f.page()).items[0].id, id, "permission revocation does not rewrite existing visibility");
  await f.enable(1, false);
  await assert.rejects(f.enable(), { status: 403 });
  f.sqlite.exec("DELETE FROM user_permission_blocks WHERE user_id=1 AND permission_key='timeline.use'");
  await f.enable();
  await recordWorkPlayed(f.runtime, 3, 1);
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
  await recordWorkPlayed(f.runtime, 2, 1);
  assert.equal(f.count("play"), 0);
  await f.enable();
  await recordWorkPlayed(f.runtime, 2, 1);
  assert.equal(f.count("play"), 0, "reenabling does not regenerate consumed first plays");
  await f.enable(1, false);
  f.sqlite.exec("UPDATE works SET status='hidden' WHERE id=5");
  await assert.rejects(recordWorkPlayed(f.runtime, 5, 1), { status: 404 });
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_first_plays WHERE user_id=1 AND work_id=5"), 0,
    "unavailable works follow the same public boundary as recent-play reports");
  f.sqlite.exec("UPDATE works SET status='published' WHERE id=5");
  await recordWorkPlayed(f.runtime, 5, 1);
  await f.enable();
  await recordWorkPlayed(f.runtime, 5, 1);
  assert.equal(f.count("play"), 0, "restoring a hidden work cannot create a false first-play replay");
  await Promise.all(Array.from({ length: 8 }, () => recordWorkPlayed(f.runtime, 3, 1)));
  assert.equal(f.count("play"), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_first_plays WHERE user_id=1 AND work_id=3"), 1);
  const id = f.number("SELECT id FROM timeline_events WHERE kind='play'");
  await deleteTimelineEvent(f.runtime, id, 1);
  await recordWorkPlayed(f.runtime, 3, 1);
  assert.equal(f.count("play"), 1, "removing an event does not reset launch identity");
  f.sqlite.exec("CREATE TRIGGER reject_play BEFORE INSERT ON timeline_events WHEN NEW.kind='play' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END");
  await assert.rejects(recordWorkPlayed(f.runtime, 4, 1));
  assert.equal(f.number("SELECT COUNT(*) FROM user_work_first_plays WHERE user_id=1 AND work_id=4"), 0);
  f.sqlite.exec("DROP TRIGGER reject_play");
  await recordWorkPlayed(f.runtime, 4, 1);
  assert.equal(f.count("play"), 2);
  f.sqlite.exec("INSERT INTO works(id,original_title,status,engine_family) VALUES(6,'Category-off launch','published','other')");
  await f.enable(1, true, TIMELINE_RECORD_KINDS.filter((kind) => kind !== "play"));
  await recordWorkPlayed(f.runtime, 6, 1);
  await f.enable();
  await recordWorkPlayed(f.runtime, 6, 1);
  assert.equal(f.count("play"), 2, "per-kind recording-off consumes the same lifetime marker");
  f.sqlite.exec("UPDATE users SET profile_show_history=0 WHERE id=1");
  assert.equal((await f.page()).items.length, 0);
});

await check("work merge preserves launch identity without synthetic user activity", async (f) => {
  await f.enable();
  await recordWorkPlayed(f.runtime, 3, 1);
  await recordWorkPlayed(f.runtime, 4, 1);
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
  await recordWorkPlayed(f.runtime, 4, 1);
  assert.equal(f.count(), before - 1);
  await recordWorkPlayed(f.runtime, 2, 1);
  await mergeWorks(f.runtime, f.actor(3), 1, 2);
  await Promise.all(f.pending);
  assert.equal(f.sqlite.prepare("SELECT first_observed_at FROM user_work_first_plays WHERE user_id=1 AND work_id=2").get()!.first_observed_at, null,
    "a legacy prior observation cannot acquire a fabricated exact first time");
  assert.equal(f.number("SELECT COUNT(*) FROM timeline_events WHERE kind='play' AND work_id=2"), 0,
    "an unknown earlier launch suppresses a later duplicate's first-play event");
});

for (const sameSecond of [false, true]) await check(`merging an ${sameSecond ? "equal-second" : "earlier"} off-period launch suppresses false first-play activity`, async (f) => {
  await recordWorkPlayed(f.runtime, 3, 1);
  f.sqlite.exec("UPDATE user_work_first_plays SET first_observed_at='2021-01-01 00:00:00' WHERE work_id=3");
  await f.enable();
  await recordWorkPlayed(f.runtime, 4, 1);
  f.sqlite.prepare("UPDATE user_work_first_plays SET first_observed_at=? WHERE work_id=4")
    .run(sameSecond ? "2021-01-01 00:00:00" : "2022-01-01 00:00:00");
  assert.equal(f.count("play"), 1);
  await mergeWorks(f.runtime, f.actor(3), 3, 4);
  await Promise.all(f.pending);
  assert.equal(f.count("play"), 0, "the earliest known launch was intentionally unrecorded");
  await recordWorkPlayed(f.runtime, 4, 1);
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
  f.sqlite.exec("UPDATE users SET status='disabled' WHERE id=1");
  assert.equal((await f.page()).items.length, 0);
  f.sqlite.exec("UPDATE users SET status='active' WHERE id=1");
  assert.equal((await f.page()).items.length, 35);
});

await check("migration and registration defaults preserve deliberate legacy privacy", async (f) => {
  for (const id of [1, 2, 3]) {
    const settings = await readTimelineSettings(f.runtime, id);
    assert.equal(settings.enabled, true);
    assert.deepEqual(settings.recordKinds, [...TIMELINE_RECORD_KINDS]);
    assert.equal(settings.timelineAsHomepage, false);
    assert.equal(settings.defaultView, "following");
  }
  for (const id of [4, 5]) {
    assert.equal(f.number("SELECT timeline_enabled FROM users WHERE id=?", id), 0);
  }
  await assert.rejects(readTimelineSettings(f.runtime, 5), { status: 404 });
  const registered = await createOrActivateVerifiedUser(f.runtime, {
    email: "registered@example.test", passwordHash: "contract-password-hash", displayName: "Registered user",
  });
  assert.equal((await readTimelineSettings(f.runtime, registered.id)).enabled, true);
  assert.deepEqual((await readTimelineSettings(f.runtime, registered.id)).recordKinds, [...TIMELINE_RECORD_KINDS]);
  assert.equal((await listTimeline(f.runtime, { actorUserId: registered.id })).items[0].kind, "join");
  assert.equal(f.count(), 0, "migration and signup do not manufacture activities");
}, true);

await check("privacy submissions preserve unseen friend settings and cannot hide the timeline", async (f) => {
  const submit = async (entries: [string, string][]) => {
    const form = new FormData();
    for (const [key, value] of entries) form.append(key, value);
    const response = await savePrivacy(await f.asUser(1), new Request(`${f.runtime.origin}/api/account/privacy`, {
      method: "POST", headers: { Origin: f.runtime.origin }, body: form,
    }));
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get("Location")!, f.runtime.origin).searchParams.get("privacyUpdated"), "1");
    return (await findUserById(f.runtime, 1))!;
  };
  let user = await submit([["showBio", "1"]]);
  assert.equal(user.profileVisibility.friends, true);
  assert.equal(f.number("SELECT notify_friend_additions FROM users WHERE id=1"), 1);
  user = await submit([["showTimeline", "0"], ["showFriends", "0"], ["notifyFriendAdditions", "0"]]);
  assert.equal(user.profileVisibility.friends, false);
  user = await submit([["showBio", "1"]]);
  assert.equal(user.profileVisibility.friends, false);
  user = await submit([["showTimeline", "0"], ["showTimeline", "1"], ["showFriends", "0"], ["showFriends", "1"],
    ["notifyFriendAdditions", "0"], ["notifyFriendAdditions", "1"]]);
  assert.equal(user.profileVisibility.friends, true);
  user = await submit([["notifyFriendAdditions", "0"]]);
  assert.equal(user.profileVisibility.friends, false);
  assert.deepEqual((await listTimeline(f.runtime, { actorUserId: 1 })).items.map((item) => item.kind), ["join"], "stale showTimeline fields cannot hide public history");
  assert.equal(hasProfileOverviewSections(user.profileVisibility), false);
});

await check("deleted public profiles remain readable while follow endpoints reject them", async (f) => {
  assert.ok(await findPublicUserById(f.runtime, 5));
  assert.equal(await readFollowSummary(f.runtime, 5, await findUserById(f.runtime, 1)), null);
  assert.ok(await readFollowSummary(f.runtime, 2, await findUserById(f.runtime, 1)));
  await assert.rejects(readFollowSummary(f.runtime, 999, null), { status: 404 });
  await assert.rejects(setUserFollow(f.runtime, 1, 5, true), { status: 404 });
  await assert.rejects(listUserFollows(f.runtime, 5, "following"), { status: 404 });
  f.sqlite.exec("UPDATE users SET status='disabled' WHERE id=2");
  assert.equal(await findPublicUserById(f.runtime, 2), null);
  await assert.rejects(readFollowSummary(f.runtime, 2, null), { status: 404 });
  const api = new Hono<{ Bindings: CloudflareEnv; Variables: { runtime: AppRuntime } }>();
  api.use("*", async (c, next) => { c.set("runtime", f.runtime); await next(); });
  api.onError((error) => jsonError("Contract request failed", error));
  api.route("/", timelineApi);
  assert.equal((await api.request(`${f.runtime.origin}/api/users/5/follow`)).status, 404);
  const active = await api.request(`${f.runtime.origin}/api/users/1/follow`);
  assert.equal(active.status, 200);
  assert.equal(active.headers.get("Cache-Control"), "private, no-store");
});

await check("friend relations, reciprocal notices, preferences and permissions are idempotent", async (f) => {
  await Promise.all(Array.from({ length: 4 }, () => setUserFollow(f.runtime, 1, 2, true)));
  assert.equal(f.number("SELECT COUNT(*) FROM user_follows"), 1);
  assert.equal(f.number("SELECT following_revision FROM users WHERE id=1"), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM inbox_items"), 1);
  assert.equal(f.sqlite.prepare("SELECT metadata_json FROM inbox_items").get()!.metadata_json, '{"friend":"added"}');
  await setUserFollow(f.runtime, 2, 1, true);
  assert.equal(f.number("SELECT COUNT(*) FROM inbox_items WHERE json_extract(metadata_json,'$.friend')='returned'"), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM inbox_item_reads WHERE user_id=2"), 1);
  const summary = await readFollowSummary(f.runtime, 2, await findUserById(f.runtime, 1));
  assert.equal(summary!.isFollowing, true);
  assert.equal(summary!.isFollowedBy, true);
  await setUserFollow(f.runtime, 1, 2, false);
  await setUserFollow(f.runtime, 1, 2, false);
  assert.equal(f.number("SELECT following_revision FROM users WHERE id=1"), 2);
  assert.equal(f.number("SELECT COUNT(*) FROM user_follows WHERE follower_user_id=2 AND followed_user_id=1"), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM inbox_items"), 2, "unfollowing does not erase notices");
  f.sqlite.exec("UPDATE users SET notify_friend_additions=0 WHERE id=3");
  await setUserFollow(f.runtime, 1, 3, true);
  f.sqlite.exec("UPDATE users SET notify_friend_additions=1 WHERE id=3");
  await setUserFollow(f.runtime, 1, 3, true);
  assert.equal(f.number("SELECT COUNT(*) FROM inbox_items WHERE recipient_user_id=3"), 0, "reenabling notifications does not backfill an existing edge");
  f.sqlite.exec("INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(1,'timeline.follow.create')");
  await assert.rejects(setUserFollow(f.runtime, 1, 2, true), { status: 403 });
  await setUserFollow(f.runtime, 1, 3, false);
  f.sqlite.exec("DELETE FROM user_permission_blocks WHERE user_id=1; INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(1,'timeline.follow.delete_own')");
  await setUserFollow(f.runtime, 1, 2, true);
  await assert.rejects(setUserFollow(f.runtime, 1, 2, false), { status: 403 });
  await assert.rejects(setUserFollow(f.runtime, 1, 1, true), { status: 400 });
  assert.equal(f.count(), 0, "friend operations never create timeline events");
});

await check("friend notification failure rolls back the relation and revision", async (f) => {
  f.sqlite.exec("CREATE TRIGGER contract_notice_failure BEFORE INSERT ON inbox_items BEGIN SELECT RAISE(ABORT,'notice failed'); END");
  await assert.rejects(setUserFollow(f.runtime, 1, 2, true), /notice failed/);
  assert.equal(f.number("SELECT COUNT(*) FROM user_follows"), 0);
  assert.equal(f.number("SELECT following_revision FROM users WHERE id=1"), 0);
});

await check("following feed verifies its viewer, privacy and relation revision across pages", async (f) => {
  for (const id of [1, 2, 3]) {
    await f.enable(id);
    await createTimelineStatus(f.runtime, id, { body: `Actor ${id}`, requestKey: `following-contract-status-${id}` });
  }
  await setUserFollow(f.runtime, 1, 2, true);
  const runtime = await f.asUser(1), input = { viewerId: 1, following: true, kind: "status" as const, limit: 1 };
  const first = await listTimeline(runtime, input);
  assert.equal(first.items[0].actor.id, 2);
  assert.ok(first.nextCursor);
  await setUserFollow(f.runtime, 1, 2, true);
  assert.equal((await listTimeline(runtime, { ...input, cursor: first.nextCursor })).items[0].actor.id, 1);
  f.sqlite.exec("UPDATE users SET status='disabled',profile_show_friends=0 WHERE id=2");
  assert.deepEqual((await listTimeline(runtime, input)).items.map((item) => item.actor.id), [1]);
  await assert.rejects(listUserFollows(f.runtime, 2, "following"), { status: 404 });
  await assert.rejects(listUserFollows(f.runtime, 2, "followers"), { status: 404 });
  await assert.rejects(listTimeline(f.runtime, input), { status: 401 });
  await assert.rejects(listTimeline(await f.asUser(2), input), { status: 401 });
  await assert.rejects(listTimeline(runtime, { ...input, actorUserId: 2 }), { status: 400 });
  await setUserFollow(f.runtime, 1, 3, true);
  await assert.rejects(listTimeline(runtime, { ...input, cursor: first.nextCursor }), { status: 409, code: "timeline_cursor_changed" });
  f.sqlite.exec("UPDATE users SET status='active' WHERE id=2");
  const list = await listUserFollows(f.runtime, 1, "following", null, 1);
  assert.equal(list.items[0].id, 3);
  assert.ok(list.nextCursor);
  assert.equal((await listUserFollows(f.runtime, 1, "following", list.nextCursor, 1)).items[0].id, 2);
  await assert.rejects(listUserFollows(f.runtime, 1, "followers", list.nextCursor), { status: 400 });
  await assert.rejects(listUserFollows(f.runtime, 2, "following", list.nextCursor), { status: 404 });
});

await check("likes and replies deduplicate and enforce current permissions and authors", async (f) => {
  await f.enable();
  const event = await createTimelineStatus(f.runtime, 1, { body: "Public status", requestKey: "interaction-status-contract-001" });
  await Promise.all(Array.from({ length: 4 }, () => setTimelineLike(f.runtime, event, 2, true)));
  const item = (await f.pageAs(2)).items[0];
  assert.equal(item.likeCount, 1);
  assert.equal(item.likedByMe, true);
  assert.equal(item.canReply, true, "a recording opt-out still allows interaction");
  const input = { body: "Reply", requestKey: "interaction-reply-contract-001" };
  const replies = await Promise.all(Array.from({ length: 4 }, () => createTimelineReply(f.runtime, event, 2, input)));
  assert.equal(new Set(replies).size, 1);
  await assert.rejects(createTimelineReply(f.runtime, event, 2, { ...input, body: "Changed" }), { status: 409 });
  assert.notEqual(await createTimelineReply(f.runtime, event, 1, input), replies[0], "request keys are isolated by author");
  assert.equal((await f.page()).items[0].replyCount, 2);
  await assert.rejects(deleteTimelineReply(f.runtime, replies[0], 1), { status: 404 });
  f.sqlite.exec("INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(2,'timeline.status.like'),(2,'timeline.reply.create'),(2,'timeline.reply.delete_own')");
  await assert.rejects(setTimelineLike(f.runtime, event, 2, false), { status: 403 });
  await assert.rejects(createTimelineReply(f.runtime, event, 2, input), { status: 403 }, "retries honor revoked permissions");
  await assert.rejects(deleteTimelineReply(f.runtime, replies[0], 2), { status: 404 });
  await deleteTimelineReply(f.runtime, replies[0], 3);
  await deleteTimelineReply(f.runtime, replies[0], 3);
  assert.equal(f.number("SELECT COUNT(*) FROM auth_audit_logs WHERE event_type='timeline_reply_moderation'"), 1);
  assert.equal(f.sqlite.prepare("SELECT body FROM timeline_status_replies WHERE id=?").get(replies[0])!.body, null);
  f.sqlite.exec("DELETE FROM user_permission_blocks WHERE user_id=2");
  await setTimelineLike(f.runtime, event, 2, false);
  await setTimelineLike(f.runtime, event, 2, false);
  assert.equal((await f.page()).items[0].likeCount, 0);
  f.sqlite.exec("UPDATE users SET status='disabled' WHERE id=1");
  await assert.rejects(listTimelineReplies(f.runtime, event), { status: 404 });
  await assert.rejects(setTimelineLike(f.runtime, event, 2, true), { status: 404 });
  assert.equal(f.count(), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM inbox_items"), 0);
});

await check("status and reply rate limits include deleted content and exempt identical retries", async (f) => {
  await f.enable();
  let deleted = 0;
  for (let i = 0; i < 5; i++) {
    const input = { body: "Limited status", requestKey: `rate-limit-status-contract-${i}` };
    deleted = await createTimelineStatus(f.runtime, 1, input);
    await deleteTimelineEvent(f.runtime, deleted, 1);
    assert.equal(await createTimelineStatus(f.runtime, 1, input), deleted);
  }
  await assert.rejects(createTimelineStatus(f.runtime, 1, { body: "Sixth", requestKey: "rate-limit-status-contract-6" }), { status: 429 });
  f.sqlite.exec("UPDATE timeline_events SET created_at=datetime('now','-2 minutes') WHERE kind='status'");
  const event = await createTimelineStatus(f.runtime, 1, { body: "New window", requestKey: "rate-limit-new-window-001" });
  for (let i = 0; i < 10; i++) {
    const input = { body: "Limited reply", requestKey: `rate-limit-reply-contract-${i}` };
    const reply = await createTimelineReply(f.runtime, event, 2, input);
    await deleteTimelineReply(f.runtime, reply, 2);
    assert.equal(await createTimelineReply(f.runtime, event, 2, input), reply);
  }
  await assert.rejects(createTimelineReply(f.runtime, event, 2, { body: "Eleventh", requestKey: "rate-limit-reply-contract-11" }), { status: 429 });
  f.sqlite.exec("UPDATE timeline_status_replies SET created_at=datetime('now','-2 minutes')");
  await createTimelineReply(f.runtime, event, 2, { body: "New reply window", requestKey: "rate-limit-new-reply-window-001" });
  assert.equal((await listTimelineReplies(f.runtime, event)).items.length, 1);
});

await check("reply pages filter hidden and inactive authors before limiting and retain deleted cursors", async (f) => {
  await f.enable();
  const event = await createTimelineStatus(f.runtime, 1, { body: "Paged replies", requestKey: "reply-pages-parent-contract-001" });
  const insert = f.sqlite.prepare("INSERT INTO timeline_status_replies(event_id,user_id,body,request_key,request_hash) VALUES(?,?,?,?,?)");
  for (let i = 1; i <= 33; i++) insert.run(event, i === 2 ? 4 : 2, `Reply ${i}`, `reply-pages-contract-${i}`, coverHash);
  await deleteTimelineReply(f.runtime, 1, 2);
  f.sqlite.exec("UPDATE users SET status='disabled' WHERE id=4");
  const first = await listTimelineReplies(await f.asUser(2), event);
  assert.equal(first.items.length, 30);
  assert.equal(first.items[0].id, 3);
  assert.ok(first.items.every((reply) => reply.canDelete));
  assert.equal(first.nextCursor, 32);
  await deleteTimelineReply(f.runtime, first.nextCursor!, 2);
  const second = await listTimelineReplies(f.runtime, event, String(first.nextCursor));
  assert.deepEqual(second.items.map((reply) => reply.id), [33]);
  assert.equal(second.nextCursor, null);
  for (const cursor of ["0", "-1", "1.5", "bad"]) await assert.rejects(listTimelineReplies(f.runtime, event, cursor), { status: 400 });
});

await check("ordered images bind once to the owning status, reply or comment", async (f) => {
  await f.enable();
  const imageIds = [f.image(), f.image()];
  const input = { body: "Images", requestKey: "image-binding-status-contract-001", imageIds };
  const event = await createTimelineStatus(f.runtime, 1, input);
  assert.equal(await createTimelineStatus(f.runtime, 1, input), event);
  assert.deepEqual((await f.page()).items[0].images.map((image) => image.id), imageIds);
  await assert.rejects(createTimelineStatus(f.runtime, 1, { ...input, imageIds: [...imageIds].reverse() }), { status: 409 });
  const unavailable = [imageIds, [f.image(2)], [f.image(), f.image()]];
  f.sqlite.prepare("UPDATE comment_images SET status='uncertain' WHERE id=?").run(unavailable[2][0]);
  for (const [i, ids] of unavailable.entries()) await assert.rejects(createTimelineStatus(f.runtime, 1, {
    body: "Unavailable", requestKey: `image-unavailable-contract-${i}`, imageIds: ids,
  }), { status: 400 });
  await assert.rejects(createTimelineStatus(f.runtime, 1, { body: "Duplicate", requestKey: "image-duplicate-contract-001", imageIds: [imageIds[0], imageIds[0]] }), { status: 400 });
  await assert.rejects(createComment(f.runtime, { kind: "work", id: 2 }, 1, "Cannot steal", undefined, imageIds, "image-comment-steal-001"), { status: 409 });
  const commentImage = f.image();
  await createComment(f.runtime, { kind: "work", id: 2 }, 1, "Comment image", undefined, [commentImage], "image-comment-owner-001");
  await assert.rejects(createTimelineStatus(f.runtime, 1, { body: "Cannot steal comment", requestKey: "image-status-steal-001", imageIds: [commentImage] }), { status: 400 });
  const replyImage = f.image(2);
  const reply = await createTimelineReply(f.runtime, event, 2, { body: "Reply image", requestKey: "image-reply-owner-001", imageIds: [replyImage] });
  assert.deepEqual((await listTimelineReplies(f.runtime, event)).items[0].images.map((image) => image.id), [replyImage]);
  assert.equal(f.number("SELECT timeline_reply_id FROM comment_images WHERE id=?", replyImage), reply);
  await assert.rejects(createTimelineReply(f.runtime, event, 2, { body: "Cannot reuse", requestKey: "image-reply-steal-001", imageIds: [replyImage] }), { status: 400 });
});

await check("image binding failure rolls back publication and preserves drafts", async (f) => {
  await f.enable();
  const image = f.image();
  f.sqlite.exec("CREATE TRIGGER contract_image_failure BEFORE UPDATE OF timeline_event_id ON comment_images BEGIN SELECT RAISE(ABORT,'binding failed'); END");
  await assert.rejects(createTimelineStatus(f.runtime, 1, { body: "Atomic publication", requestKey: "atomic-image-contract-001", imageIds: [image] }), /binding failed/);
  assert.equal(f.count(), 0);
  assert.equal(f.sqlite.prepare("SELECT timeline_event_id FROM comment_images WHERE id=?").get(image)!.timeline_event_id, null);
  f.sqlite.exec("DROP TRIGGER contract_image_failure");
  await createTimelineStatus(f.runtime, 1, { body: "Atomic publication", requestKey: "atomic-image-contract-001", imageIds: [image] });
  assert.equal(f.count(), 1);
});

await check("image reads and cleanup respect current parent status and the deletion grace period", async (f) => {
  await f.enable();
  const statusImage = f.image(), replyImage = f.image(2);
  const event = await createTimelineStatus(f.runtime, 1, { body: "Visible images", requestKey: "image-visibility-status-001", imageIds: [statusImage] });
  await createTimelineReply(f.runtime, event, 2, { body: "Visible reply", requestKey: "image-visibility-reply-001", imageIds: [replyImage] });
  for (const id of [statusImage, replyImage]) {
    const response = await readCommentImage(f.runtime, id);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  f.sqlite.exec("UPDATE comment_images SET updated_at=datetime('now','-8 days'); UPDATE users SET status='disabled' WHERE id=1");
  for (const id of [statusImage, replyImage]) assert.equal((await readCommentImage(await f.asUser(1), id)).status, 404);
  await assert.rejects(listTimelineReplies(f.runtime, event), { status: 404 });
  await assert.rejects(setTimelineLike(f.runtime, event, 2, true), { status: 404 });
  await assert.rejects(createTimelineReply(f.runtime, event, 2, { body: "Hidden parent", requestKey: "image-hidden-parent-reply-001" }), { status: 404 });
  assert.deepEqual(await cleanupCommentImages(f.db, f.runtime.bucket), { cleaned: 0, failed: [] });
  f.sqlite.exec("UPDATE users SET status='active' WHERE id=1; UPDATE users SET status='disabled' WHERE id=2");
  assert.equal((await readCommentImage(f.runtime, replyImage)).status, 404);
  assert.equal((await f.page()).items[0].replyCount, 0);
  f.sqlite.exec("UPDATE users SET status='active' WHERE id=2");
  await deleteTimelineEvent(f.runtime, event, 1);
  for (const id of [statusImage, replyImage]) assert.equal((await readCommentImage(f.runtime, id)).status, 404);
  assert.deepEqual(await cleanupCommentImages(f.db, f.runtime.bucket), { cleaned: 0, failed: [] });
  f.sqlite.exec("UPDATE timeline_events SET hidden_at=datetime('now','-8 days') WHERE kind='status'");
  assert.deepEqual(await cleanupCommentImages(f.db, f.runtime.bucket), { cleaned: 2, failed: [] });
  assert.deepEqual(f.deletedObjects.sort(), [statusImage, replyImage].map((id) => `comment-images/${id}`).sort());
  const draft = f.image();
  assert.equal((await readCommentImage(await f.asUser(2), draft)).status, 404);
  assert.equal((await readCommentImage(f.runtime, draft)).status, 404);
  assert.equal((await readCommentImage(await f.asUser(1), draft)).status, 200);
});

await check("every account has one permanent join record at its registration time", async (f) => {
  assert.equal(f.count("join"), 5, "private and deleted legacy accounts are included");
  assert.equal(f.number("SELECT COUNT(*) FROM timeline_events e JOIN users u ON u.id=e.user_id WHERE e.kind='join' AND e.created_at=u.created_at"), 5);
  assert.equal((await listTimeline(f.runtime, { actorUserId: 5 })).items[0].kind, "join");
  const join = (await listTimeline(await f.asUser(1), { actorUserId: 1, viewerId: 1 })).items[0];
  assert.equal(join.canDelete, false);
  assert.equal(join.canLike, false);
  assert.equal(join.canReply, false);
  assert.equal(join.target, null);
  assert.equal(join.work, null);
  assert.deepEqual(join.images, []);
  for (const id of [1, 3]) await assert.rejects(deleteTimelineEvent(f.runtime, join.id, id), { status: 404 });
  await assert.rejects(setTimelineLike(f.runtime, join.id, 2, true), { status: 404 });
  await assert.rejects(createTimelineReply(f.runtime, join.id, 2, { body: "Not interactive", requestKey: "permanent-join-reply-contract" }), { status: 404 });
  assert.throws(() => f.sqlite.prepare("UPDATE timeline_events SET hidden_at=CURRENT_TIMESTAMP WHERE id=?").run(join.id), /permanent/);
  assert.throws(() => f.sqlite.prepare("DELETE FROM timeline_events WHERE id=?").run(join.id), /permanent/);
  assert.equal(f.number("SELECT COUNT(*) FROM auth_audit_logs WHERE event_type='timeline_moderation'"), 0);
  const input = { email: "join-new@example.test", passwordHash: "contract-hash", displayName: "New join account" };
  const created = await createOrActivateVerifiedUser(f.runtime, input);
  await createOrActivateVerifiedUser(f.runtime, input);
  assert.equal(f.number("SELECT COUNT(*) FROM timeline_events WHERE user_id=? AND kind='join'", created.id), 1);
  const item = (await listTimeline(f.runtime, { actorUserId: created.id })).items[0];
  assert.equal(item.createdAt, created.createdAt);
  assert.equal(f.count(), 0);
});

await check("renames preserve their original names atomically regardless of activity recording", async (f) => {
  f.sqlite.exec("INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(1,'timeline.use')");
  const original = (await findUserById(f.runtime, 1))!;
  const rename = async (displayName: string) => updateOwnProfile(f.runtime, { user: (await findUserById(f.runtime, 1))!, displayName, bio: "" });
  await rename("Renamed A");
  await rename("Renamed A");
  assert.equal(f.count("rename"), 1, "same-name saves are not renames");
  await rename("Renamed B");
  const items = (await listTimeline(await f.asUser(3), { actorUserId: 1, viewerId: 3, kind: "rename" })).items;
  assert.deepEqual(items.map((item) => item.nameChange), [
    { previousName: "Renamed A", newName: "Renamed B" },
    { previousName: original.displayName, newName: "Renamed A" },
  ]);
  assert.ok(items.every((item) => !item.canDelete && !item.canLike && !item.canReply && !item.images.length));
  assert.equal((await readTimelineSettings(f.runtime, 1)).enabled, false);
  const beforeAudit = f.number("SELECT COUNT(*) FROM auth_audit_logs");
  f.sqlite.exec("CREATE TRIGGER contract_rename_failure BEFORE INSERT ON timeline_events WHEN NEW.kind='rename' BEGIN SELECT RAISE(ABORT,'history write failed'); END");
  await assert.rejects(rename("Must roll back"), /history write failed/);
  assert.equal((await findUserById(f.runtime, 1))!.displayName, "Renamed B");
  assert.equal(f.count("rename"), 2);
  assert.equal(f.number("SELECT COUNT(*) FROM auth_audit_logs"), beforeAudit);
  f.sqlite.exec("DROP TRIGGER contract_rename_failure; INSERT INTO user_permission_blocks(user_id,permission_key) VALUES(1,'user.rename_own')");
  await assert.rejects(rename("Denied rename"), { status: 403 });
  f.sqlite.exec("UPDATE users SET status='deleted',display_name='账户已注销' WHERE id=1");
  assert.equal(f.count("rename"), 2, "account deletion must not publish a fake rename");
  assert.equal((await listTimeline(f.runtime, { actorUserId: 1, kind: "rename" })).items.length, 2);
  assert.throws(() => f.sqlite.prepare("DELETE FROM users WHERE id=1").run(), /permanent/);
});

await check("account-history migration preserves interactions, unavailable emoji references and image ownership", async (f) => {
  assert.equal(f.number("SELECT id FROM timeline_events WHERE event_key='preserved-status'"), 900);
  assert.equal(f.number("SELECT hidden_at IS NOT NULL FROM timeline_events WHERE id=901"), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM timeline_status_likes WHERE event_id=900 AND user_id=2"), 1);
  assert.equal(f.number("SELECT event_id FROM timeline_status_replies WHERE id=900"), 900);
  assert.equal(f.number("SELECT COUNT(*) FROM timeline_event_face_emojis WHERE content_id=900"), 1);
  assert.equal(f.number("SELECT COUNT(*) FROM timeline_reply_face_emojis WHERE content_id=900"), 1);
  assert.equal(f.number("SELECT timeline_event_id FROM comment_images WHERE id='preserved-event-image'"), 900);
  assert.equal(f.number("SELECT timeline_reply_id FROM comment_images WHERE id='preserved-reply-image'"), 900);
  assert.equal(f.number("SELECT position FROM comment_images WHERE id='preserved-reply-image'"), 1);
  assert.ok(f.number("SELECT MIN(id) FROM timeline_events WHERE kind='join'") > 1000, "previously allocated IDs are not reused");
}, false, (sqlite) => {
  sqlite.exec(`INSERT INTO timeline_events(id,user_id,kind,action,event_key,body) VALUES(900,1,'status','发表了吐槽','preserved-status','Historical status');
    INSERT INTO timeline_events(id,user_id,kind,action,event_key,body,hidden_at) VALUES(901,1,'status','发表了吐槽','preserved-hidden',NULL,CURRENT_TIMESTAMP);
    INSERT INTO timeline_events(id,user_id,kind,action,event_key,body) VALUES(1000,1,'status','发表了吐槽','removed-highest','Removed');
    DELETE FROM timeline_events WHERE id=1000;
    INSERT INTO timeline_status_likes(event_id,user_id) VALUES(900,2);
    INSERT INTO timeline_status_replies(id,event_id,user_id,body,request_key,request_hash) VALUES(900,900,2,'Historical reply','preserved-reply','hash');
    INSERT INTO blobs(sha256,size_bytes,content_type_hint) VALUES('${"b".repeat(64)}',${png.length},'image/png');
    INSERT INTO face_sheets(blob_sha256,width_px,height_px,source_kind,library_status) VALUES('${"b".repeat(64)}',48,48,'user_upload','approved');
    INSERT INTO face_emoji_refs(id,blob_sha256,cell_row,cell_column,width_px,height_px) VALUES(900,'${"b".repeat(64)}',0,0,48,48);
    INSERT INTO timeline_event_face_emojis(content_id,emoji_id) VALUES(900,900);
    INSERT INTO timeline_reply_face_emojis(content_id,emoji_id) VALUES(900,900);
    UPDATE face_sheets SET library_status='pending' WHERE blob_sha256='${"b".repeat(64)}';
    INSERT INTO comment_images(id,user_id,client_id,fingerprint,status,object_key,format,size,width,height,timeline_event_id,position)
      VALUES('preserved-event-image',1,'preserved-event-client','hash','ready','comment-images/preserved-event-image','png',${png.length},1,1,900,0);
    INSERT INTO comment_images(id,user_id,client_id,fingerprint,status,object_key,format,size,width,height,timeline_reply_id,position)
      VALUES('preserved-reply-image',2,'preserved-reply-client','hash','ready','comment-images/preserved-reply-image','png',${png.length},1,1,900,1);`);
});

console.log("Timeline persistent contracts passed");
