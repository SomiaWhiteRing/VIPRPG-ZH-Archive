import type { CreatorLink } from "@/lib/creator-links";
import type {
  CharacterCreditSelection,
  CharacterPortrait,
  CharacterPortraitChoice,
} from "@/lib/character-names";
import type { CreatorSelection } from "@/lib/creator-names";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { WorkDistribution } from "@/lib/dto/db/work-distribution";
import type { StaffCredit } from "@/lib/staff-credits";
import type { WorkMoreInfo } from "@/lib/work-more-info";

export type GameTag = { id: number; name: string; namespace: string };

export type GameCharacter = {
  id: number;
  primaryName: string;
  originalName: string;
  displayName: string;
  portrait: CharacterPortrait | null;
  portraitChoice: CharacterPortraitChoice | null;
  roleKey: string;
  spoilerLevel: number;
  sortOrder: number | null;
  notes: string | null;
};

export type GameCreatorCredit = {
  id: number;
  name: string;
  displayName: string;
  links: CreatorLink[];
  roleKey: string;
  roleLabel: string | null;
  notes: string | null;
};

export type GameMediaAsset = {
  blobSha256: string;
  role: "cover" | "preview";
  title: string | null;
  altText: string | null;
  sortOrder: number | null;
};

export type GameExternalLink = {
  id: number;
  label: string;
  url: string;
  linkType: string;
};

export type GameArchiveVersionDetail = {
  usesSharedPlayer: boolean;
  webPlayFileCount: number;
  webPlaySizeBytes: number;
  id: number;
  language: string;
  isCurrent: boolean;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  publishedAt: string | null;
  uploaderId: number | null;
  uploaderName: string | null;
};

export type GameWorkRelation = {
  id: number;
  direction: "from";
  relationType: string;
  workId: number;
  title: string;
  originalTitle: string;
  chineseTitle: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  language: string;
  viceVersa: boolean;
  createdByUserId: number | null;
  coverBlobSha256?: string | null;
};

export type GameTranslationRelation = {
  id: number;
  role: "original" | "translation";
  workId: number;
  title: string;
  originalTitle: string;
  chineseTitle: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  language: string;
  createdByUserId: number | null;
  coverBlobSha256?: string | null;
};

export type GameWorkSummary = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  originalReleasePrecision: string;
  engineFamily: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  status: string;
  coverBlobSha256: string | null;
  currentArchiveVersionId: number | null;
  externalDownloadUrl: string | null;
  archiveVersionCount: number;
  totalSizeBytes: number;
  latestPublishedAt: string | null;
  tags: GameTag[];
  characters: GameCharacter[];
  creators: GameCreatorCredit[];
  distribution: WorkDistribution;
};

export type GameWorkDetail = GameWorkSummary & {
  usesUnsupportedManiac: boolean;
  moreInfo: WorkMoreInfo[];
  aliases: string[];
  creators: GameCreatorCredit[];
  media: GameMediaAsset[];
  externalLinks: GameExternalLink[];
  archiveVersions: GameArchiveVersionDetail[];
  relations: GameWorkRelation[];
  translations: GameTranslationRelation[];
  parallelTranslations: GameTranslationRelation[];
};

export type AdminWorkEdit = {
  hasUsableDistribution: boolean;
  usesUnsupportedManiac: boolean;
  moreInfo: WorkMoreInfo[];
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  originalReleasePrecision: string;
  engineFamily: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  status: "processing" | "published" | "hidden" | "deleted";
  aliases: string[];
  creators: GameCreatorCredit[];
  tags: string[];
  characters: CharacterCreditSelection[];
  characterCredits: GameCharacter[];
  media: GameMediaAsset[];
  outgoingRelations: GameWorkRelation[];
  translations: GameTranslationRelation[];
  parallelTranslations: GameTranslationRelation[];
  externalLinks: GameExternalLink[];
};

export type AdminArchiveVersionEdit = {
  id: number;
  workId: number;
  workTitle: string;
  language: string;
  isCurrent: boolean;
  status: "processing" | "published" | "hidden";
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  manifestSha256: string;
  filePolicyVersion: string;
  packerVersion: string;
  sourceType: string;
  sourceName: string | null;
  sourceFileCount: number;
  sourceSizeBytes: number;
  excludedFileCount: number;
  excludedSizeBytes: number;
  createdAt: string;
  publishedAt: string | null;
  uploaderName: string | null;
  sourceUrl: string | null;
};

export type ExternalWorkInput = {
  moreInfo: WorkMoreInfo[];
  user: ArchiveUser;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  aliases: string[];
  tags: string[];
  characters: CharacterCreditSelection[];
  authors: CreatorSelection[];
  extraStaff?: StaffCredit[];
  translators: CreatorSelection[];
  coverBlobSha256: string;
  previewBlobSha256s: string[];
  downloadUrl: string;
};

export type UserWorkListItem = {
  work: GameWorkSummary;
  occurredAt: string;
};

export type UploaderWorkEdit = AdminWorkEdit & {
  distribution: "archive" | "external";
  externalDownloadUrl: string | null;
  hasCurrentArchive: boolean;
  currentArchive: {
    id: number;
    sourceName: string;
    sourceFileCount: number;
    sourceSizeBytes: number;
    publishedAt: string | null;
    sourceUrl: string | null;
  } | null;
};

export type UploaderWorkUpdateInput = {
  usesUnsupportedManiac: boolean;
  moreInfo: WorkMoreInfo[];
  user: ArchiveUser;
  workId: number;
  distribution: "archive" | "external";
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  status: "published" | "hidden";
  aliases: string[];
  tags: string[];
  characters: CharacterCreditSelection[];
  authors: CreatorSelection[];
  extraStaff?: StaffCredit[];
  translators: CreatorSelection[];
  coverBlobSha256: string;
  previewBlobSha256s: string[];
  downloadUrl: string | null;
};

export type PaginatedGameSearch = {
  items: GameWorkSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
