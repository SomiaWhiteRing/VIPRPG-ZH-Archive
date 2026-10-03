import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { blobKey, corePackKey, manifestKey } from "../lib/archive/object-keys";
import { runScheduledArchiveGc } from "../worker/archive-gc.mjs";

const hash = (value: number) => value.toString(16).padStart(64, "0");
const failedManifest = manifestKey(hash(1));

function createFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  sqlite.exec(`
    INSERT INTO works(id,original_title,engine_family,status) VALUES
      (1,'Failed upload','rpg_maker_2003','processing'),
      (2,'Published game','rpg_maker_2003','published');
    INSERT INTO archive_versions(id,work_id,manifest_sha256,file_policy_version,packer_version,source_type,status,is_current,created_at)
      VALUES(1,1,'${hash(1)}','fixture','fixture','browser_zip','processing',0,datetime('now','-2 days')),
            (2,2,'${hash(2)}','fixture','fixture','browser_zip','published',1,datetime('now','-2 days'));
    INSERT INTO import_jobs(id,work_id,status,failed_stage,updated_at)
      VALUES(1,1,'failed','commit',datetime('now','-2 days'));
  `);
  for (const n of [10, 11, 12]) {
    sqlite.prepare("INSERT INTO blobs(sha256,size_bytes,first_seen_archive_version_id) VALUES(?,1,1)").run(hash(n));
  }
  for (const n of [20, 21, 22]) {
    sqlite.prepare("INSERT INTO core_packs(id,sha256,size_bytes,uncompressed_size_bytes,file_count,first_seen_archive_version_id) VALUES(?,?,1,1,1,1)").run(n, hash(n));
  }
  sqlite.exec(`
    INSERT INTO archive_version_blob_refs VALUES(1,'${hash(10)}'),(1,'${hash(11)}'),(2,'${hash(10)}');
    INSERT INTO archive_version_core_pack_refs VALUES(1,20),(1,21),(2,20);
  `);
  // Unlinked first_seen rows reproduce a commit interrupted before all refs
  // were inserted. The schema, SQL and GC are real; only D1/R2 transports differ.
  const objects = new Set([
    failedManifest, manifestKey(hash(2)),
    ...[10, 11, 12].map((n) => blobKey(hash(n))),
    ...[20, 21, 22].map((n) => corePackKey(hash(n))),
  ]);
  const deleted: string[] = [];
  const faults = { failNextR2Delete: false, beforeBatch: null as (() => void) | null };
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
    DB: {
      prepare: (sql: string) => new Statement(sql),
      async batch(statements: Statement[]) {
        const beforeBatch = faults.beforeBatch;
        faults.beforeBatch = null;
        beforeBatch?.();
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
      async list() { return { objects: [] }; },
      async delete(key: string) {
        deleted.push(key);
        if (faults.failNextR2Delete) {
          faults.failNextR2Delete = false;
          throw new Error("R2 unavailable");
        }
        objects.delete(key);
      },
    },
  };
  return { sqlite, env, objects, deleted, faults };
}

type Fixture = ReturnType<typeof createFixture>;
async function check(name: string, run: (fixture: Fixture) => Promise<void>) {
  const fixture = createFixture();
  try {
    await run(fixture);
    assert.deepEqual(fixture.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    console.log(`Archive GC: ${name} passed`);
  } finally { fixture.sqlite.close(); }
}

function assertRemoved(f: Fixture) {
  assert.equal(f.sqlite.prepare("SELECT id FROM archive_versions WHERE id=1").get(), undefined);
  assert.equal(f.sqlite.prepare("SELECT id FROM works WHERE id=1").get(), undefined);
  assert.equal(f.objects.has(failedManifest), false);
  assert.equal(f.sqlite.prepare("SELECT status FROM import_jobs WHERE id=1").get()!.status, "expired");
  assert.equal(f.sqlite.prepare("SELECT work_id FROM import_jobs WHERE id=1").get()!.work_id, null);
}

function assertSharedObjectsRetained(f: Fixture) {
  assert.equal(f.sqlite.prepare("SELECT first_seen_archive_version_id AS origin FROM blobs WHERE sha256=?").get(hash(10))!.origin, 2);
  assert.equal(f.sqlite.prepare("SELECT first_seen_archive_version_id AS origin FROM core_packs WHERE id=20").get()!.origin, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_version_blob_refs WHERE archive_version_id=2").get()!.n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_version_core_pack_refs WHERE archive_version_id=2").get()!.n, 1);
  assert.equal(f.sqlite.prepare("SELECT is_current FROM archive_versions WHERE id=2").get()!.is_current, 1);
  for (const n of [10, 11, 12]) assert.equal(f.objects.has(blobKey(hash(n))), true);
  for (const n of [20, 21, 22]) assert.equal(f.objects.has(corePackKey(hash(n))), true);
}

await check("foreign keys, interrupted refs and shared provenance", async (f) => {
  const report = await runScheduledArchiveGc(f.env);
  assert.equal(report.processing.expiredCount, 1);
  assert.equal(report.processing.failedCount, 0);
  assertRemoved(f);
  assertSharedObjectsRetained(f);
  for (const n of [11, 12]) {
    assert.equal(f.sqlite.prepare("SELECT first_seen_archive_version_id AS origin FROM blobs WHERE sha256=?").get(hash(n))!.origin, null);
  }
  for (const n of [21, 22]) {
    assert.equal(f.sqlite.prepare("SELECT first_seen_archive_version_id AS origin FROM core_packs WHERE id=?").get(n)!.origin, null);
  }
  assert.equal((await runScheduledArchiveGc(f.env)).processing.expiredCount, 0);
  assert.deepEqual(f.deleted, [failedManifest]);
});

await check("R2 failure preserves a retry target", async (f) => {
  f.faults.failNextR2Delete = true;
  const failed = await runScheduledArchiveGc(f.env);
  assert.equal(failed.processing.failedCount, 1);
  assert.equal(failed.processing.expiredCount, 0);
  assert.equal(f.objects.has(failedManifest), true);
  assert.ok(f.sqlite.prepare("SELECT purged_at FROM archive_versions WHERE id=1").get()!.purged_at);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_version_blob_refs WHERE archive_version_id=1").get()!.n, 0);
  assertSharedObjectsRetained(f);
  const retried = await runScheduledArchiveGc(f.env);
  assert.equal(retried.processing.failedCount, 0);
  assert.equal(retried.processing.expiredCount, 1);
  assertRemoved(f);
});

await check("D1 preparation failure keeps the manifest and retries immediately", async (f) => {
  f.sqlite.exec(`CREATE TRIGGER reject_cleanup BEFORE DELETE ON archive_version_blob_refs
    WHEN OLD.archive_version_id=1 BEGIN SELECT RAISE(ABORT,'D1 unavailable'); END;`);
  const failed = await runScheduledArchiveGc(f.env);
  assert.equal(failed.processing.failedCount, 1);
  assert.deepEqual(f.deleted, []);
  assert.equal(f.objects.has(failedManifest), true);
  assert.equal(f.sqlite.prepare("SELECT purged_at FROM archive_versions WHERE id=1").get()!.purged_at, null);
  assert.equal(f.sqlite.prepare("SELECT first_seen_archive_version_id AS origin FROM blobs WHERE sha256=?").get(hash(10))!.origin, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_version_blob_refs WHERE archive_version_id=1").get()!.n, 2);
  f.sqlite.exec("DROP TRIGGER reject_cleanup");
  const retried = await runScheduledArchiveGc(f.env);
  assert.equal(retried.processing.failedCount, 0);
  assert.equal(retried.processing.expiredCount, 1);
  assertRemoved(f);
});

await check("D1 final deletion failure can retry an already deleted manifest", async (f) => {
  f.sqlite.exec(`CREATE TRIGGER reject_cleanup BEFORE DELETE ON archive_versions
    WHEN OLD.id=1 BEGIN SELECT RAISE(ABORT,'D1 unavailable'); END;`);
  const failed = await runScheduledArchiveGc(f.env);
  assert.equal(failed.processing.failedCount, 1);
  assert.equal(f.objects.has(failedManifest), false);
  assert.ok(f.sqlite.prepare("SELECT purged_at FROM archive_versions WHERE id=1").get()!.purged_at);
  f.sqlite.exec("DROP TRIGGER reject_cleanup");
  const retried = await runScheduledArchiveGc(f.env);
  assert.equal(retried.processing.failedCount, 0);
  assert.equal(retried.processing.expiredCount, 1);
  assertRemoved(f);
});

await check("a shared manifest and published work remain available", async (f) => {
  f.sqlite.prepare("UPDATE archive_versions SET manifest_sha256=? WHERE id=2").run(hash(1));
  f.sqlite.exec("UPDATE works SET status='published' WHERE id=1");
  const report = await runScheduledArchiveGc(f.env);
  assert.equal(report.processing.failedCount, 0);
  assert.equal(report.processing.expiredCount, 1);
  assert.equal(f.sqlite.prepare("SELECT id FROM archive_versions WHERE id=1").get(), undefined);
  assert.equal(f.sqlite.prepare("SELECT status FROM works WHERE id=1").get()!.status, "published");
  assert.equal(f.objects.has(failedManifest), true);
  assert.deepEqual(f.deleted, []);
  assertSharedObjectsRetained(f);
});

await check("a stale archive without an import job is removed", async (f) => {
  f.sqlite.exec("DELETE FROM import_jobs WHERE id=1");
  const report = await runScheduledArchiveGc(f.env);
  assert.equal(report.processing.failedCount, 0);
  assert.equal(report.processing.expiredCount, 1);
  assert.equal(f.sqlite.prepare("SELECT id FROM archive_versions WHERE id=1").get(), undefined);
  assert.equal(f.objects.has(failedManifest), false);
  assertSharedObjectsRetained(f);
});

await check("recent activity and completed jobs prevent expiry", async (f) => {
  f.sqlite.exec("UPDATE import_jobs SET updated_at=CURRENT_TIMESTAMP WHERE id=1");
  const recent = await runScheduledArchiveGc(f.env);
  assert.equal(recent.processing.expiredCount, 0);
  assert.equal(f.objects.has(failedManifest), true);
  f.sqlite.exec("UPDATE import_jobs SET status='completed',updated_at=datetime('now','-2 days') WHERE id=1");
  const completed = await runScheduledArchiveGc(f.env);
  assert.equal(completed.processing.expiredCount, 0);
  assert.equal(completed.processing.skippedCount, 1);
  assert.equal(f.sqlite.prepare("SELECT purged_at FROM archive_versions WHERE id=1").get()!.purged_at, null);
  assert.deepEqual(f.deleted, []);
});

await check("new activity between selection and reservation preserves the archive", async (f) => {
  f.faults.beforeBatch = () => f.sqlite.exec("INSERT INTO import_jobs(id,work_id,status) VALUES(3,1,'uploading_metadata')");
  const report = await runScheduledArchiveGc(f.env);
  assert.equal(report.processing.expiredCount, 0);
  assert.equal(report.processing.skippedCount, 1);
  assert.equal(f.sqlite.prepare("SELECT purged_at FROM archive_versions WHERE id=1").get()!.purged_at, null);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_version_blob_refs WHERE archive_version_id=1").get()!.n, 2);
  assert.deepEqual(f.deleted, []);
});

await check("publication between selection and reservation preserves the archive", async (f) => {
  f.faults.beforeBatch = () => f.sqlite.exec(`
    UPDATE archive_versions SET status='published',is_current=1 WHERE id=1;
    UPDATE works SET status='published' WHERE id=1;
    UPDATE import_jobs SET status='completed' WHERE id=1;
  `);
  const report = await runScheduledArchiveGc(f.env);
  assert.equal(report.processing.expiredCount, 0);
  assert.equal(report.processing.skippedCount, 1);
  assert.equal(f.sqlite.prepare("SELECT status FROM archive_versions WHERE id=1").get()!.status, "published");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM archive_version_blob_refs WHERE archive_version_id=1").get()!.n, 2);
  assert.deepEqual(f.deleted, []);
});

console.log("Archive GC contracts passed: provenance, shared references, atomic preparation, expiry guards and durable retries.");
