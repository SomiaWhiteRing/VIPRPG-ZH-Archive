import { getD1 } from "@/lib/server/db/d1";

export type AdminSummary = {
  users: number;
  works: number;
  archiveVersions: number;
  blobs: {
    count: number;
    sizeBytes: number;
  };
  corePacks: {
    count: number;
    sizeBytes: number;
  };
  importJobs: number;
  downloadBuilds: number;
};

export async function getAdminSummary(): Promise<AdminSummary> {
  const row = await getD1().prepare(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM works) AS works,
       (SELECT COUNT(*) FROM archive_versions) AS archive_versions,
       (SELECT COUNT(*) FROM blobs) AS blobs,
       (SELECT COALESCE(SUM(size_bytes),0) FROM blobs) AS blob_size,
       (SELECT COUNT(*) FROM core_packs) AS core_packs,
       (SELECT COALESCE(SUM(size_bytes),0) FROM core_packs) AS core_pack_size,
       (SELECT COUNT(*) FROM import_jobs) AS import_jobs,
       (SELECT COUNT(*) FROM download_builds) AS download_builds`,
  ).first<{
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

  return {
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
}
