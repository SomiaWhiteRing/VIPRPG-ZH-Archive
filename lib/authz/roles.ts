export type RoleId = number;
export type RoleKey = string;
export type RoleKind = "built_in" | "bootstrap_admin" | "custom";
export type RoleStatus = "active" | "disabled";

export const SYSTEM_ROLE_PRIORITIES = {
  user: 100,
  uploader: 400,
  admin: 700,
  super_admin: 1000,
} as const;

export const CUSTOM_ROLE_PRIORITY_MIN = 101;
export const CUSTOM_ROLE_PRIORITY_MAX = 699;

export function isCustomRolePriority(value: number): boolean {
  return Number.isSafeInteger(value) &&
    value >= CUSTOM_ROLE_PRIORITY_MIN &&
    value <= CUSTOM_ROLE_PRIORITY_MAX;
}
