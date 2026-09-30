import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { PermissionKey } from "@/lib/authz/permissions";

export type AdminUserAccessUpdate = {
  userId: number;
  user: Pick<ArchiveUser, "id" | "status" | "roleIds" | "roleKeys" | "roleNames" | "permissionKeys" | "maxRolePriority" | "isBootstrapAdmin"> | null;
  roleIds: number[];
  blockedKeys: PermissionKey[];
  actorChanged: boolean;
};

export type PublicUserProfile = Pick<
  ArchiveUser,
  "id" | "displayName" | "avatarBlobSha256" | "profileVisibility" | "createdAt"
> & { bio: string | null };
