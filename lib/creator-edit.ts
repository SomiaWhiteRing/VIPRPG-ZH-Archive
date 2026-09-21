import type { PublicCreatorDetail } from "@/lib/dto/db/creator-library";

export const CREATOR_EDIT_LIMITS = { name: 120, bio: 5000 } as const;

export type CreatorMetadata = Pick<PublicCreatorDetail, "name" | "aliases" | "links" | "bio">;

export function creatorMetadataSnapshot(creator: CreatorMetadata): string {
  return JSON.stringify([creator.name, creator.links, creator.bio, [...creator.aliases].sort()]);
}
