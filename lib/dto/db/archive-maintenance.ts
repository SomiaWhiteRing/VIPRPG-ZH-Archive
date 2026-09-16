export type AdminArchiveVersion = {
  id: number;
  workId: number;
  workTitle: string;
  language: string;
  status: "processing" | "published" | "hidden" | "deleted";
  isCurrent: boolean;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  createdAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  uploaderId: number | null;
  maintainerIds: number[];
  workDeleted: boolean;
  uploaderName: string | null;
};

export type PaginatedAdminArchiveVersions = {
  items: AdminArchiveVersion[];
  total: number;
  page: number;
  pageSize: number;
};
