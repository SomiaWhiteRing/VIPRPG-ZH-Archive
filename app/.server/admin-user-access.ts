import { findUserById } from "./db/users";
import { canManageUser, listUserPermissionBlocks, listUserRoleMemberships } from "./db/permissions";
import type { AppRuntime } from "./runtime";
import { hasPermission } from "@/lib/authz/permissions";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { AdminUserAccessUpdate } from "@/lib/dto/db/users";

export async function readAdminUserAccess(runtime: AppRuntime, actor: ArchiveUser, userId: number): Promise<AdminUserAccessUpdate> {
  const [currentActor, user] = await Promise.all([findUserById(runtime, actor.id), findUserById(runtime, userId)]);
  const actorChanged = !currentActor || currentActor.status !== actor.status
    || currentActor.maxRolePriority !== actor.maxRolePriority || currentActor.isBootstrapAdmin !== actor.isBootstrapAdmin
    || [...currentActor.permissionKeys].sort().join() !== [...actor.permissionKeys].sort().join();
  if (!currentActor || !hasPermission(currentActor, "user.read") || !user || !canManageUser(currentActor, user))
    return { userId, user: null, roleIds: [], blockedKeys: [], actorChanged };
  const [memberships, blocks] = await Promise.all([
    listUserRoleMemberships(runtime, [userId]), listUserPermissionBlocks(runtime, [userId]),
  ]);
  return {
    userId, actorChanged, roleIds: memberships.get(userId) ?? [], blockedKeys: blocks.get(userId) ?? [],
    user: { id: user.id, status: user.status, roleIds: user.roleIds, roleKeys: user.roleKeys, roleNames: user.roleNames,
      permissionKeys: user.permissionKeys, maxRolePriority: user.maxRolePriority, isBootstrapAdmin: user.isBootstrapAdmin },
  };
}
