import type { CreatorLink } from "@/lib/creator-links";

export type CreatorWorkCredit = {
  workId: number;
  workTitle: string;
  workOriginalTitle: string;
  displayName: string;
  roleKey: string;
  roleLabel: string | null;
  notes: string | null;
  authorName: string;
  originalReleaseDate: string | null;
  engineFamily: string;
  language: string;
  coverBlobSha256: string | null;
  status: string;
};

export type PublicCreatorSummary = {
  id: number;
  name: string;
  avatarBlobSha256: string | null;
  links: CreatorLink[];
  bio: string | null;
  workCreditCount: number;
  latestWorkCreditAt: string | null;
};

export type PublicCreatorDetail = PublicCreatorSummary & {
  aliases: string[];
  workCredits: CreatorWorkCredit[];
};

export type PublicCreatorListItem = Pick<
  PublicCreatorSummary,
  "id" | "name" | "avatarBlobSha256" | "bio" | "workCreditCount"
> & {
  aliases: string[];
};

export type AdminCreatorEdit = PublicCreatorSummary & {
  aliases: string[];
  createdAt: string;
  updatedAt: string;
  extra: Record<string, unknown>;
  adminWorkCredits: CreatorWorkCredit[];
};
