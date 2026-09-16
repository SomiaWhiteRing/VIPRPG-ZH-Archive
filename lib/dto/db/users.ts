import type { ArchiveUser } from "@/lib/dto/db/user-access";

export type PublicUserProfile = Pick<
  ArchiveUser,
  "id" | "displayName" | "avatarBlobSha256" | "profileVisibility" | "createdAt"
> & { bio: string | null };
