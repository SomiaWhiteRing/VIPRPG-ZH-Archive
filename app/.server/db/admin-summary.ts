import { getD1 } from "@/app/.server/db/d1";
import { memoizeRequest, type AppRuntime } from "@/app/.server/runtime";
import type { AdminSummary } from "@/lib/dto/db/admin-summary";

// Advisory totals may lag by 30 seconds. Authorization still runs on each
// page/API request; only settled aggregate numbers cross request boundaries.
const summaries = new WeakMap<D1Database, { at: number; value: AdminSummary }>();
const summaryFreshMs = 30_000;

export function getAdminSummary(
  runtime: AppRuntime,
): Promise<AdminSummary> {
  return memoizeRequest(runtime, "admin-summary", () => readAdminSummary(runtime));
}

async function readAdminSummary(
  runtime: AppRuntime,
): Promise<AdminSummary> {
  const database = getD1(runtime);
  const cached = summaries.get(database);
  if (cached && Date.now() - cached.at < summaryFreshMs) return cached.value;
  const row = await database
    .prepare(
      `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM works) AS works,
       (SELECT COUNT(*) FROM archive_versions) AS archive_versions,
       blob_totals.count AS blobs,
       blob_totals.size AS blob_size,
       pack_totals.count AS core_packs,
       pack_totals.size AS core_pack_size,
       (SELECT COUNT(*) FROM import_jobs) AS import_jobs,
       (SELECT COUNT(*) FROM download_builds) AS download_builds
       FROM (SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS size FROM blobs) blob_totals
       CROSS JOIN (SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS size FROM core_packs) pack_totals`,
    )
    .first<{
      users: number;
      works: number;
      archive_versions: number;
      blobs: number;
      blob_size: number;
      core_packs: number;
      core_pack_size: number;
      import_jobs: number;
      download_builds: number;
    }>();
  if (!row) throw new Error("Admin summary query returned no row");

  const value: AdminSummary = {
    users: row.users,
    works: row.works,
    archiveVersions: row.archive_versions,
    blobs: {
      count: row.blobs,
      sizeBytes: row.blob_size,
    },
    corePacks: {
      count: row.core_packs,
      sizeBytes: row.core_pack_size,
    },
    importJobs: row.import_jobs,
    downloadBuilds: row.download_builds,
  };
  summaries.set(database, { at: Date.now(), value });
  return value;
}
