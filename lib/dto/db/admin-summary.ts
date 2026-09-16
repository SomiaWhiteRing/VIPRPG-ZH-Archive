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
