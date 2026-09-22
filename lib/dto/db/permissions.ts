import type {
  PermissionDefinition,
  PermissionKey,
} from "@/lib/authz/permissions";
import type { RoleKind, RoleStatus } from "@/lib/authz/roles";
import type { InboxItemStatus } from "@/lib/dto/db/inbox";

export type Permission = PermissionDefinition;

export type RoleSummary = {
  id: number;
  key: string;
  name: string;
  description: string;
  priority: number;
  kind: RoleKind;
  status: RoleStatus;
  applicationEnabled: boolean;
  availableToAll: boolean;
  userCount: number;
  permissionKeys: PermissionKey[];
};

export type RoleRequestSummary = {
  id: number;
  status: InboxItemStatus;
  closedReason: string | null;
  requestedRole: { id: number; key: string; name: string } | null;
};

export type AccountRoleOption = Pick<RoleSummary,
  "id" | "key" | "name" | "description" | "status" | "applicationEnabled" | "availableToAll"
> & {
  individuallyAssigned: boolean;
  granted: boolean;
  request: RoleRequestSummary | null;
};
