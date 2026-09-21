import { hasPermission, type PermissionKey } from "@/lib/authz/permissions";

export const CREATOR_PUBLIC_EDIT_PERMISSIONS = [
  "creator.metadata.update_public",
  "creator.metadata.update_any",
] as const satisfies readonly PermissionKey[];

export function canEditPublicCreator(user: Parameters<typeof hasPermission>[0]): boolean {
  return CREATOR_PUBLIC_EDIT_PERMISSIONS.some((key) => hasPermission(user, key));
}
