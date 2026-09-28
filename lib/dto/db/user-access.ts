import type { PermissionKey } from "@/lib/authz/permissions";
import type { ProfileVisibility } from "@/lib/user-profile";
import type { AccountPreferences } from "@/lib/account-preferences";

export type UserStatus = "active" | "disabled" | "deleted";

export type ArchiveUser = {
  id: number;
  email: string;
  externalAuthId: string;
  displayName: string;
  avatarBlobSha256: string | null;
  bio: string;
  profileVisibility: ProfileVisibility;
  preferences: AccountPreferences;
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
