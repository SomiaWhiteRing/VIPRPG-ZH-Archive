import type { PermissionKey } from "@/lib/authz/permissions";
import type { ProfileVisibility } from "@/lib/user-profile";

export type UserStatus = "active" | "disabled" | "deleted";

export type ArchiveUser = {
  id: number;
  email: string;
  externalAuthId: string;
  displayName: string;
  avatarBlobSha256: string | null;
  bio: string;
  profileVisibility: ProfileVisibility;
  roleIds: number[];
  roleKeys: string[];
  roleNames: string[];
  permissionKeys: PermissionKey[];
  maxRolePriority: number;
  isBootstrapAdmin: boolean;
  status: UserStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};
