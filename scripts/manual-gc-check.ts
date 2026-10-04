import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AuthContext } from "../app/.server/auth/current-user";
import { POST } from "../app/.server/endpoints/api/admin/gc/sweep/route";
import type { AppRuntime } from "../app/.server/runtime";
import { blobKey, corePackKey, manifestKey } from "../lib/archive/object-keys";
import { handleManualGc } from "../app/.server/storage/manual-gc";
import type { GcJobAction, GcJobReport } from "../lib/archive/gc-job";

// Irreversible-cleanup contracts use the complete production migration chain
// against a fresh in-memory database. Only the D1 and R2 transports are mocked;
// this script never opens a running Worker, local seed database or remote store.
const hash = (value: number) => value.toString(16).padStart(64, "0");
const actor = { id: 1, email: "cleanup@example.test" };
const otherActor = { id: 2, email: "other@example.test" };
const old = "2001-01-01 00:00:00";
const origin = "https://cleanup.example.test";
type StoredObject = { size: number; version: string };
type Body = { action: GcJobAction; jobId?: string; graceDays?: number; confirm?: string };

function createFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  sqlite.exec(`INSERT INTO users(id,external_auth_id,email,display_name) VALUES
    (1,'fixture:cleanup','${actor.email}','Cleanup'),
    (2,'fixture:other','${otherActor.email}','Other');
    INSERT INTO works(id,original_title,engine_family,status) VALUES
    (900000,'Published fixture','rpg_maker_2003','published');
    INSERT INTO archive_versions(id,work_id,manifest_sha256,file_policy_version,packer_version,source_type,status,is_current,created_at)
    VALUES(900000,900000,'${hash(900000)}','fixture','fixture','browser_zip','published',1,'${old}');`);
  const objects = new Map<string, StoredObject>();
  const deleted: string[] = [];
  const heads: string[] = [];
  const faults = {
    failHeads: new Set<string>(),
    failDeletes: new Set<string>(),
    deleteThenFail: new Set<string>(),
    beforeDelete: null as ((key: string) => void) | null,
  };
  class Statement {
    constructor(private sql: string, private values: (string | number | null)[] = []) {}
    bind(...values: (string | number | null)[]) { return new Statement(this.sql, values); }
    execute() {
      const results = sqlite.prepare(this.sql).all(...this.values);
      const changes = Number(sqlite.prepare("SELECT changes() AS n").get()!.n);
      return { results, success: true, meta: { changes } };
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
    async first() { return this.execute().results[0] ?? null; }
  }
  const env = {
    APP_ORIGIN: origin,
    DB: {
      prepare: (sql: string) => new Statement(sql),
      async batch(statements: Statement[]) {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((statement) => statement.execute());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
    ARCHIVE_BUCKET: {
      async head(key: string) {
        heads.push(key);
        if (faults.failHeads.delete(key)) throw new Error("Injected R2 HEAD failure");
        const value = objects.get(key);
        return value ? { key, ...value } : null;
      },
      async list() { throw new Error("Manual cleanup must not scan arbitrary R2 namespaces"); },
      async delete(key: string) {
        deleted.push(key);
        faults.beforeDelete?.(key);
        if (faults.failDeletes.delete(key)) throw new Error("Injected R2 delete failure");
        objects.delete(key);
        if (faults.deleteThenFail.delete(key)) throw new Error("Injected uncertain R2 delete result");
      },
    },
  };
  const runtime = {
    request: new Request(`${origin}/api/admin/gc/sweep`), env, db: env.DB, bucket: env.ARCHIVE_BUCKET,
    origin, memo: new Map(), execution: { waitUntil() {}, passThroughOnException() {} },
  } as unknown as AppRuntime;
  function put(key: string, size: number, version = `fixture:${key}`) {
    objects.set(key, { size, version });
  }
  function archive(id: number, options: { manifest?: number; files?: number; bytes?: number; deletedAt?: string } = {}) {
    const manifest = options.manifest ?? id;
    sqlite.prepare("INSERT INTO works(id,original_title,engine_family,status) VALUES(?,?,'rpg_maker_2003','deleted')")
      .run(id, `Archive ${id}`);
    sqlite.prepare(`INSERT INTO archive_versions(id,work_id,manifest_sha256,file_policy_version,packer_version,source_type,
      status,created_at,deleted_at,total_files,total_size_bytes) VALUES(?,?,?,'fixture','fixture','browser_zip','deleted',?,?,?,?)`)
      .run(id, id, hash(manifest), old, options.deletedAt ?? old, options.files ?? 2, options.bytes ?? 1000);
    put(manifestKey(hash(manifest)), 100 + manifest);
  }
  function blob(id: number, bytes = 200 + id, archiveId?: number) {
    sqlite.prepare("INSERT INTO blobs(sha256,size_bytes,created_at,first_seen_archive_version_id) VALUES(?,?,?,?)")
      .run(hash(id), bytes, old, archiveId ?? null);
    if (archiveId !== undefined) sqlite.prepare("INSERT INTO archive_version_blob_refs VALUES(?,?)").run(archiveId, hash(id));
    put(blobKey(hash(id)), bytes);
  }
  function core(id: number, bytes = 300 + id, archiveId?: number) {
    sqlite.prepare(`INSERT INTO core_packs(id,sha256,size_bytes,uncompressed_size_bytes,file_count,created_at,first_seen_archive_version_id)
      VALUES(?,?,?,?,1,?,?)`).run(id, hash(id), bytes, bytes * 2, old, archiveId ?? null);
    if (archiveId !== undefined) sqlite.prepare("INSERT INTO archive_version_core_pack_refs VALUES(?,?)").run(archiveId, id);
    put(corePackKey(hash(id)), bytes);
  }
  return { sqlite, runtime, objects, deleted, heads, faults, put, archive, blob, core };
}

type Fixture = ReturnType<typeof createFixture>;
async function check(name: string, run: (fixture: Fixture) => Promise<void>) {
  const fixture = createFixture();
  try {
    await run(fixture);
    assert.deepEqual(fixture.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    console.log(`Manual GC: ${name} passed`);
  } finally { fixture.sqlite.close(); }
}

async function call(f: Fixture, body: Body): Promise<GcJobReport> {
  const report = await handleManualGc(f.runtime, actor, body);
  assert.ok(report, `${body.action} must return its persisted report`);
  return report;
}
async function scan(f: Fixture, initial?: GcJobReport) {
  let report = initial ?? await call(f, { action: "start", graceDays: 7 });
  for (let requests = 0; report.status === "scanning"; requests++) {
    assert.ok(requests < 10000, "scan must make bounded cursor progress");
    report = await call(f, { action: "scan", jobId: report.id });
  }
  assert.equal(report.status, "ready");
  return report;
}
async function run(f: Fixture, initial: GcJobReport) {
  let report = initial;
  for (let requests = 0; report.status === "running"; requests++) {
    assert.ok(requests < 10000, "sweep must make bounded item progress");
    report = await call(f, { action: "run", jobId: report.id });
  }
  return report;
}
async function confirm(f: Fixture, ready: GcJobReport) {
  return call(f, { action: "confirm", jobId: ready.id, confirm: "SWEEP" });
}
function businessData(f: Fixture) {
  // Equality is used only for the read-only safety boundary, not as a golden
  // schema snapshot: migrations and unrelated business-table contents may vary.
  const tables = f.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'archive_gc_%' AND name<>'auth_audit_logs' ORDER BY name`).all();
  return tables.map(({ name }) => [name, f.sqlite.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`)
    .all().map((row) => JSON.stringify(row)).sort()]);
}
function itemState(f: Fixture, jobId: string, type: string, objectId: string) {
  return f.sqlite.prepare("SELECT state,error FROM archive_gc_job_items WHERE job_id=? AND type=? AND object_id=?")
    .get(jobId, type, objectId);
}
function authContext(id = actor.id, permitted = true): AuthContext {
  // Supply the complete DTO while keeping account/session loading outside this
  // endpoint's contract. Access is determined by explicit permission grants.
  const permissionKeys: AuthContext["permissionKeys"] = permitted ? ["storage.gc.sweep"] : [];
  return {
    session: { id: 1, userId: id },
    user: {
      id, email: id === actor.id ? actor.email : otherActor.email,
      externalAuthId: `fixture:${id}`, displayName: `Fixture ${id}`,
      avatarBlobSha256: null, bio: "",
      profileVisibility: { bio: true, showcase: true, timeline: true, friends: true, favorites: true, history: true, catalogs: true, comments: true, discussions: true },
      preferences: {
        colorTheme: "system", timelineAsHomepage: false, notifyUploadedWorkComments: true, notifyFriendAdditions: true, includePlayerInZip: true,
        showGameCardInteractionData: true, hideDeletedContent: false, shortcuts: [],
      },
      roleIds: [], roleKeys: [], roleNames: [], permissionKeys,
      maxRolePriority: 1000, isBootstrapAdmin: false, status: "active",
      emailVerifiedAt: old, lastLoginAt: null, createdAt: old, updatedAt: old,
    },
    roleKeys: [], permissionKeys, maxRolePriority: 1000, isBootstrapAdmin: false,
  };
}
async function post(f: Fixture, body: unknown, options: { auth?: AuthContext | null; requestOrigin?: string } = {}) {
  const request = new Request(`${origin}/api/admin/gc/sweep`, {
    method: "POST", headers: { "content-type": "application/json", origin: options.requestOrigin ?? origin },
    body: JSON.stringify(body),
  });
  const runtime = { ...f.runtime, request, memo: new Map([["auth", Promise.resolve(options.auth === undefined ? authContext() : options.auth)]]) };
  return POST(runtime, request);
}

await check("empty scan, explicit confirmation and idempotent completion", async (f) => {
  assert.equal(await handleManualGc(f.runtime, actor, { action: "status" }), null);
  for (const graceDays of [-1, 0.5, 3651, Number.NaN]) {
    await assert.rejects(handleManualGc(f.runtime, actor, { action: "start", graceDays }), { status: 400 });
  }
  const initial = await call(f, { action: "start", graceDays: 0 });
  assert.equal((await call(f, { action: "start", graceDays: 7 })).id, initial.id);
  await assert.rejects(call(f, { action: "confirm", jobId: initial.id, confirm: "SWEEP" }), { status: 409 });
  const ready = await scan(f, initial);
  assert.equal(ready.totalItems, 0);
  assert.equal(ready.objectSizeBytes, 0);
  assert.equal(ready.archiveCount, 0);
  await assert.rejects(call(f, { action: "run", jobId: ready.id }), { status: 409 });
  await assert.rejects(call(f, { action: "confirm", jobId: ready.id, confirm: "sweep" }), { status: 400 });
  const confirmed = await confirm(f, ready);
  assert.deepEqual(await confirm(f, ready), confirmed);
  const complete = await run(f, confirmed);
  assert.equal(complete.status, "completed");
  assert.deepEqual(await call(f, { action: "run", jobId: ready.id }), complete);
  assert.deepEqual(await confirm(f, ready), complete);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM auth_audit_logs WHERE event_type='gc_sweep_confirmed'").get()!.n, 1);
  assert.deepEqual(f.deleted, []);
});

await check("complete pagination and exact unique physical bytes beyond 1,000 candidates per type", async (f) => {
  const count = 1003;
  let archiveBytes = 0;
  for (let id = 1; id <= count; id++) {
    f.archive(id, { files: 3, bytes: 100000 + id });
    f.blob(id, 200 + id, id);
    f.core(id, 300 + id, id);
    archiveBytes += 100000 + id;
  }
  // Store sizes deliberately differ from ledger sizes. The recoverable-space
  // estimate must use the distinct, actual R2 objects, including manifests.
  f.put(blobKey(hash(1)), 17);
  f.objects.delete(corePackKey(hash(2)));
  f.put("tools/never-clean-this.zip", 987654);
  const physicalObjects = [...f.objects].filter(([key]) => key !== "tools/never-clean-this.zip");
  const physicalBytes = physicalObjects.reduce((sum, [, object]) => sum + object.size, 0);
  const before = businessData(f);
  const ready = await scan(f);
  assert.deepEqual(businessData(f), before, "scanning must not alter business objects or references");
  assert.deepEqual(f.deleted, []);
  assert.equal(ready.archiveCount, count);
  assert.equal(ready.archiveFileCount, count * 3);
  assert.equal(ready.archiveSizeBytes, archiveBytes);
  assert.equal(ready.scannedCount, count * 4);
  assert.equal(ready.totalItems, count * 4);
  assert.equal(ready.objectCount, count * 3 - 1);
  assert.equal(ready.missingObjectCount, 1);
  assert.equal(ready.objectSizeBytes, physicalBytes);
  assert.deepEqual(await call(f, { action: "scan", jobId: ready.id }), ready);
  const finished = await run(f, await confirm(f, ready));
  assert.equal(finished.status, "completed");
  assert.equal(finished.purgedArchiveCount, count);
  assert.equal(finished.deletedObjectCount, physicalObjects.length);
  assert.equal(finished.deletedSizeBytes, physicalBytes);
  assert.equal(finished.failedCount, 0);
  assert.equal(finished.skippedCount, 0);
  assert.equal(finished.processedItems, count * 4);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_versions WHERE purged_at IS NOT NULL").get()!.n, count);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_version_blob_refs").get()!.n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_version_core_pack_refs").get()!.n, 0);
  assert.deepEqual([...f.objects.keys()], ["tools/never-clean-this.zip"]);
  assert.equal(new Set(f.deleted).size, count * 3);
  const calls = f.deleted.length;
  assert.deepEqual(await call(f, { action: "run", jobId: ready.id }), finished);
  assert.equal(f.deleted.length, calls);
});

await check("shared blobs, core packs and manifests are retained and counted once", async (f) => {
  for (let id = 1; id <= 33; id++) f.archive(id, { manifest: 10 });
  f.archive(34, { manifest: 11 });
  f.sqlite.prepare("UPDATE archive_versions SET manifest_sha256=? WHERE id=900000").run(hash(11));
  f.blob(1, 123, 1);
  f.core(1, 234, 1);
  f.sqlite.exec(`INSERT INTO archive_version_blob_refs VALUES(2,'${hash(1)}');
    INSERT INTO archive_version_core_pack_refs VALUES(2,1);`);
  f.blob(2, 345, 34);
  f.core(2, 456, 34);
  f.sqlite.exec(`INSERT INTO archive_version_blob_refs VALUES(900000,'${hash(2)}');
    INSERT INTO archive_version_core_pack_refs VALUES(900000,2);`);
  const ready = await scan(f);
  assert.equal(ready.archiveCount, 34);
  assert.equal(ready.objectCount, 3);
  assert.equal(ready.objectSizeBytes, 123 + 234 + 110);
  const complete = await run(f, await confirm(f, ready));
  assert.equal(complete.status, "completed");
  assert.equal(complete.purgedArchiveCount, 34);
  assert.equal(complete.deletedObjectCount, 3);
  assert.equal(f.deleted.filter((key) => key === manifestKey(hash(10))).length, 1);
  for (const key of [blobKey(hash(2)), corePackKey(hash(2)), manifestKey(hash(11))]) assert.ok(f.objects.has(key));
  assert.equal(f.sqlite.prepare("SELECT is_current FROM archive_versions WHERE id=900000").get()!.is_current, 1);
});

await check("long retained prefixes do not truncate later eligible candidates", async (f) => {
  const retained = 1003;
  for (let id = 1; id <= retained; id++) {
    f.archive(id, { deletedAt: "2999-01-01 00:00:00" });
    f.blob(id, 20 + id, id);
    f.core(id, 30 + id, id);
  }
  f.archive(2000); f.blob(2000, 21, 2000); f.core(2000, 31, 2000);
  const ready = await scan(f);
  assert.equal(ready.archiveCount, 1);
  assert.equal(ready.objectCount, 3);
  assert.equal(ready.objectSizeBytes, 21 + 31 + 2100);
  assert.equal(ready.totalItems, 4);
  assert.equal(ready.scannedCount, 4);
  const complete = await run(f, await confirm(f, ready));
  assert.equal(complete.status, "completed");
  assert.equal(complete.purgedArchiveCount, 1);
  assert.equal(complete.deletedObjectCount, 3);
  assert.equal(f.objects.size, retained * 3);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_versions WHERE purged_at IS NOT NULL").get()!.n, 1);
});

await check("scan and both cancellation stages leave all business data untouched", async (f) => {
  f.archive(1); f.blob(1, 21, 1); f.core(1, 31, 1);
  for (const fullyScan of [false, true]) {
    const before = businessData(f);
    const objects = [...f.objects];
    let job = await call(f, { action: "start", graceDays: 7 });
    job = fullyScan ? await scan(f, job) : await call(f, { action: "scan", jobId: job.id });
    const cancelled = await call(f, { action: "cancel", jobId: job.id });
    assert.equal(cancelled.status, "cancelled");
    assert.deepEqual(await call(f, { action: "cancel", jobId: job.id }), cancelled);
    assert.deepEqual(await call(f, { action: "scan", jobId: job.id }), cancelled);
    await assert.rejects(call(f, { action: "confirm", jobId: job.id, confirm: "SWEEP" }), { status: 409 });
    assert.deepEqual(businessData(f), before);
    assert.deepEqual([...f.objects], objects);
    assert.deepEqual(f.deleted, []);
  }
});

await check("new candidates and R2 objects never expand a confirmed snapshot", async (f) => {
  f.archive(1); f.blob(1, 21, 1); f.core(1, 31, 1);
  const ready = await scan(f);
  const frozenItems = f.sqlite.prepare("SELECT type,object_id,snapshot_json FROM archive_gc_job_items WHERE job_id=? ORDER BY type,object_id").all(ready.id);
  f.archive(2); f.blob(2, 22, 2); f.core(2, 32, 2);
  f.blob(3, 23); f.core(3, 33);
  const complete = await run(f, await confirm(f, ready));
  assert.equal(complete.status, "completed");
  assert.equal(complete.totalItems, ready.totalItems);
  assert.equal(complete.purgedArchiveCount, 1);
  assert.equal(complete.deletedSizeBytes, ready.objectSizeBytes);
  assert.deepEqual(f.sqlite.prepare("SELECT type,object_id,snapshot_json FROM archive_gc_job_items WHERE job_id=? ORDER BY type,object_id").all(ready.id), frozenItems);
  for (const key of [manifestKey(hash(2)), blobKey(hash(2)), corePackKey(hash(2)), blobKey(hash(3)), corePackKey(hash(3))]) {
    assert.ok(f.objects.has(key), `new object must survive: ${key}`);
  }
  assert.equal(f.sqlite.prepare("SELECT purged_at FROM archive_versions WHERE id=2").get()!.purged_at, null);
});

await check("restoration, late references, timestamp changes and replaced R2 versions invalidate candidates", async (f) => {
  f.archive(1); f.archive(2);
  for (let id = 1; id <= 5; id++) { f.blob(id, 20 + id, id <= 2 ? id : undefined); f.core(id, 30 + id, id <= 2 ? id : undefined); }
  const ready = await scan(f);
  f.sqlite.exec(`UPDATE archive_versions SET status='published',deleted_at=NULL WHERE id=1;
    UPDATE archive_versions SET deleted_at=CURRENT_TIMESTAMP WHERE id=2;
    INSERT INTO archive_version_blob_refs VALUES(900000,'${hash(3)}');
    INSERT INTO archive_version_core_pack_refs VALUES(900000,3);
    UPDATE blobs SET verified_at=CURRENT_TIMESTAMP WHERE sha256='${hash(4)}';
    UPDATE core_packs SET created_at=CURRENT_TIMESTAMP WHERE id=4;`);
  f.put(blobKey(hash(5)), 25, "replacement-blob");
  f.put(corePackKey(hash(5)), 35, "replacement-core");
  const before = businessData(f);
  const complete = await run(f, await confirm(f, ready));
  assert.equal(complete.status, "completed");
  assert.equal(complete.skippedCount, ready.totalItems);
  assert.equal(complete.purgedArchiveCount, 0);
  assert.equal(complete.deletedSizeBytes, 0);
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(businessData(f), before);
});

await check("external references added after scan preserve a blob", async (f) => {
  f.blob(1, 21);
  const ready = await scan(f);
  f.sqlite.prepare("UPDATE users SET avatar_blob_sha256=? WHERE id=2").run(hash(1));
  const complete = await run(f, await confirm(f, ready));
  assert.equal(complete.status, "completed");
  assert.equal(complete.skippedCount, 1);
  assert.ok(f.objects.has(blobKey(hash(1))));
  assert.deepEqual(f.deleted, []);
});

await check("failed HEAD commits no partial page or inflated totals", async (f) => {
  f.blob(1, 21); f.blob(2, 22);
  let job = await call(f, { action: "start", graceDays: 7 });
  job = await call(f, { action: "scan", jobId: job.id });
  f.faults.failHeads.add(blobKey(hash(2)));
  await assert.rejects(call(f, { action: "scan", jobId: job.id }), /Injected R2 HEAD failure/);
  assert.deepEqual(await call(f, { action: "status", jobId: job.id }), job);
  assert.equal(f.sqlite.prepare("SELECT lock_token FROM archive_gc_jobs WHERE id=?").get(job.id)!.lock_token, null);
  const ready = await scan(f, job);
  assert.equal(ready.totalItems, 2);
  assert.equal(ready.objectSizeBytes, 43);
  assert.deepEqual(f.deleted, []);
});

await check("partial R2 failures and uncertain deletes remain retryable without double counting", async (f) => {
  f.archive(1); f.blob(1, 21, 1); f.blob(2, 22); f.core(1, 31, 1);
  const ready = await scan(f);
  f.faults.failDeletes.add(blobKey(hash(1)));
  f.faults.deleteThenFail.add(corePackKey(hash(1)));
  const failed = await run(f, await confirm(f, ready));
  assert.equal(failed.status, "needs_retry");
  assert.equal(failed.failedCount, 2);
  assert.equal(failed.deletedObjectCount, 2);
  assert.equal(failed.deletedSizeBytes, 22 + 101);
  assert.equal(failed.purgedArchiveCount, 1);
  assert.ok(f.objects.has(blobKey(hash(1))));
  assert.equal(f.objects.has(corePackKey(hash(1))), false);
  assert.equal(itemState(f, ready.id, "blob", hash(1))!.state, "deleting");
  assert.equal(itemState(f, ready.id, "core_pack", hash(1))!.state, "deleting");
  const retry = await call(f, { action: "retry", jobId: ready.id });
  await assert.rejects(call(f, { action: "retry", jobId: ready.id }), { status: 409 });
  const complete = await run(f, retry);
  assert.equal(complete.status, "completed");
  assert.equal(complete.failedCount, 0);
  assert.equal(complete.deletedObjectCount, ready.objectCount);
  assert.equal(complete.deletedSizeBytes, ready.objectSizeBytes);
  assert.equal(complete.processedItems, ready.totalItems);
  assert.deepEqual(await call(f, { action: "run", jobId: ready.id }), complete);
});

for (const type of ["blob", "core_pack", "manifest"] as const) {
  await check(`${type} post-delete D1 failure retains progress and counts recovered bytes once`, async (f) => {
    if (type === "blob") f.blob(1, 21);
    else if (type === "core_pack") f.core(1, 31);
    else f.archive(1);
    const key = type === "blob" ? blobKey(hash(1)) : type === "core_pack" ? corePackKey(hash(1)) : manifestKey(hash(1));
    const ready = await scan(f);
    f.sqlite.exec(`CREATE TRIGGER reject_cleanup_progress BEFORE UPDATE OF state ON archive_gc_job_items
      WHEN NEW.type='${type}' AND NEW.state='deleted'
      BEGIN SELECT RAISE(ABORT,'Injected post-delete D1 failure'); END;`);
    const failed = await run(f, await confirm(f, ready));
    assert.equal(failed.status, "needs_retry");
    assert.equal(failed.failedCount, 1);
    assert.equal(f.objects.has(key), false, "the injected failure must occur after R2 deletion");
    assert.equal(failed.deletedObjectCount, 0);
    assert.equal(failed.deletedSizeBytes, 0);
    assert.equal(itemState(f, ready.id, type, hash(1))!.state, "deleting");
    f.sqlite.exec("DROP TRIGGER reject_cleanup_progress");
    const complete = await run(f, await call(f, { action: "retry", jobId: ready.id }));
    assert.equal(complete.status, "completed");
    assert.equal(complete.failedCount, 0);
    assert.equal(complete.deletedObjectCount, 1);
    assert.equal(complete.deletedSizeBytes, ready.objectSizeBytes);
    assert.deepEqual(await call(f, { action: "run", jobId: ready.id }), complete);
  });
}

await check("failed archive preparation preserves references and retries dependent objects", async (f) => {
  f.archive(1); f.blob(1, 21, 1); f.core(1, 31, 1);
  const ready = await scan(f);
  f.sqlite.exec(`CREATE TRIGGER reject_archive_cleanup BEFORE DELETE ON archive_version_blob_refs
    WHEN OLD.archive_version_id=1 BEGIN SELECT RAISE(ABORT,'Injected archive preparation failure'); END;`);
  const failed = await run(f, await confirm(f, ready));
  assert.equal(failed.status, "needs_retry");
  assert.equal(failed.purgedArchiveCount, 0);
  assert.equal(failed.failedCount, ready.totalItems);
  assert.equal(failed.skippedCount, 0);
  assert.deepEqual(f.deleted, []);
  assert.equal(f.sqlite.prepare("SELECT purged_at FROM archive_versions WHERE id=1").get()!.purged_at, null);
  f.sqlite.exec("DROP TRIGGER reject_archive_cleanup");
  const complete = await run(f, await call(f, { action: "retry", jobId: ready.id }));
  assert.equal(complete.status, "completed");
  assert.equal(complete.purgedArchiveCount, 1);
  assert.equal(complete.deletedObjectCount, 3);
  assert.equal(complete.deletedSizeBytes, ready.objectSizeBytes);
});

await check("reservations reject late references during R2 deletion", async (f) => {
  f.archive(1); f.blob(1, 21, 1); f.core(1, 31, 1);
  const ready = await scan(f);
  const checked = new Set<string>();
  f.faults.beforeDelete = (key) => {
    checked.add(key);
    if (key === blobKey(hash(1))) {
      assert.throws(() => f.sqlite.prepare("INSERT INTO archive_version_blob_refs VALUES(900000,?)").run(hash(1)));
      assert.throws(() => f.sqlite.prepare("UPDATE users SET avatar_blob_sha256=? WHERE id=2").run(hash(1)));
    } else if (key === corePackKey(hash(1))) {
      assert.throws(() => f.sqlite.exec("INSERT INTO archive_version_core_pack_refs VALUES(900000,1)"));
    } else if (key === manifestKey(hash(1))) {
      assert.throws(() => f.sqlite.exec("UPDATE archive_versions SET purged_at=NULL,status='published' WHERE id=1"));
      assert.throws(() => f.sqlite.prepare("UPDATE archive_versions SET manifest_sha256=? WHERE id=900000").run(hash(1)));
    }
  };
  const complete = await run(f, await confirm(f, ready));
  assert.equal(complete.status, "completed");
  assert.equal(checked.size, 3);
});

await check("ownership, same-origin, permission and confirmation gates protect the POST endpoint", async (f) => {
  f.blob(1, 21);
  const before = businessData(f);
  for (const options of [{ auth: null }, { auth: authContext(1, false) }, { requestOrigin: "https://attacker.example.test" }]) {
    const response = await post(f, { action: "start", graceDays: 7 }, options);
    assert.equal(response.status, options.auth === null ? 401 : 403);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_gc_jobs").get()!.n, 0);
  const response = await post(f, { action: "start", graceDays: 7 });
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; job: GcJobReport };
  assert.equal(body.ok, true);
  const id = body.job.id;
  for (const action of ["status", "scan", "confirm", "run", "retry", "cancel"] as const) {
    const foreign = await post(f, { action, jobId: id, confirm: "SWEEP" }, { auth: authContext(2) });
    assert.equal(foreign.status, 404, `another actor must not ${action} this job`);
  }
  assert.equal((await post(f, { action: "run", jobId: id })).status, 409);
  const ready = await scan(f, body.job);
  assert.equal((await post(f, { action: "confirm", jobId: id })).status, 400);
  assert.equal((await post(f, { action: "run", jobId: id, confirm: "SWEEP" })).status, 409);
  assert.deepEqual(businessData(f), before);
  assert.deepEqual(f.deleted, []);
  assert.equal((await post(f, { action: "confirm", jobId: id, confirm: "SWEEP" })).status, 200);
  const complete = await run(f, await call(f, { action: "status", jobId: ready.id }));
  assert.equal(complete.status, "completed");
  assert.equal(complete.deletedObjectCount, 1);
});

await check("busy lease and expired confirmation fail closed", async (f) => {
  f.blob(1, 21);
  const ready = await scan(f);
  f.sqlite.prepare("UPDATE archive_gc_jobs SET lock_token='other-request',locked_at=CURRENT_TIMESTAMP WHERE id=?").run(ready.id);
  await assert.rejects(confirm(f, ready), { status: 409 });
  f.sqlite.prepare("UPDATE archive_gc_jobs SET locked_at=? WHERE id=?").run(old, ready.id);
  await assert.rejects(confirm(f, ready), { status: 409 });
  assert.equal(f.sqlite.prepare("SELECT lock_token FROM archive_gc_jobs WHERE id=?").get(ready.id)!.lock_token, "other-request");
  f.sqlite.prepare("UPDATE archive_gc_jobs SET lock_token=NULL,locked_at=NULL,created_at=? WHERE id=?").run(old, ready.id);
  await assert.rejects(confirm(f, ready), { status: 409 });
  assert.equal((await call(f, { action: "status", jobId: ready.id })).confirmedAt, null);
  assert.deepEqual(f.deleted, []);
});

console.log("Manual GC contracts passed: immutable full scans, exact physical sizes, authorization, preservation guards and durable deletion retries.");
