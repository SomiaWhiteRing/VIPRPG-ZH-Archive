export type CatalogItem = {
  workId: number;
  title: string;
  originalTitle: string;
  chineseTitle: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  language: string;
  coverBlobSha256: string | null;
  sortOrder: number;
  note: string | null;
};

export type CatalogSummary = {
  id: number;
  ownerUserId: number;
  ownerName: string;
  title: string;
  description: string | null;
  itemCount: number;
  coverBlobSha256: string | null;
  customCoverBlobSha256: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogDetail = CatalogSummary & {
  ownerProfileShowsCatalogs: boolean;
  items: CatalogItem[];
};

export type CatalogInput = {
  title?: string;
  description?: string | null;
  coverBlobSha256?: string;
};
