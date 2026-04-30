import { getD1 } from "@/lib/server/db/d1";

type CountRow = {
  count: number;
};

type SumRow = {
  total: number | null;
};

export type AdminSummary = {
  users: number;
  games: number;
  gameVersions: number;
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
  const [
    users,
    games,
    gameVersions,
    blobs,
    blobSize,
    corePacks,
    corePackSize,
    importJobs,
    downloadBuilds,
  ] = await Promise.all([
    countTable("users"),
    countTable("games"),
    countTable("game_versions"),
    countTable("blobs"),
    sumTable("blobs", "size_bytes"),
    countTable("core_packs"),
    sumTable("core_packs", "size_bytes"),
    countTable("import_jobs"),
    countTable("download_builds"),
  ]);

  return {
    users,
    games,
    gameVersions,
    blobs: {
      count: blobs,
      sizeBytes: blobSize,
    },
    corePacks: {
      count: corePacks,
      sizeBytes: corePackSize,
    },
    importJobs,
    downloadBuilds,
  };
}

async function countTable(tableName: string): Promise<number> {
  const row = await getD1()
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .first<CountRow>();

  return row?.count ?? 0;
}

async function sumTable(tableName: string, columnName: string): Promise<number> {
  const row = await getD1()
    .prepare(`SELECT SUM(${columnName}) AS total FROM ${tableName}`)
    .first<SumRow>();

  return row?.total ?? 0;
}
