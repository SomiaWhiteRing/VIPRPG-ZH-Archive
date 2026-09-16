import type {
  PermissionDefinition,
  PermissionKey,
} from "@/lib/authz/permissions";
import type { RoleKind, RoleStatus } from "@/lib/authz/roles";

export type Permission = PermissionDefinition;

export type RoleSummary = {
  id: number;
  key: string;
  name: string;
  description: string;
  priority: number;
  kind: RoleKind;
  status: RoleStatus;
  userCount: number;
  permissionKeys: PermissionKey[];
};

export type RoleRequestSummary = {
  id: number;
  status: string;
  requestedRole: { id: number; key: string; name: string } | null;
};
