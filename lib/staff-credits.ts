import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";

export type StaffCredit = ArchiveCommitMetadata["workStaff"][number];
export const EXTRA_STAFF_ROLES = [
  { value: "scenario", label: "剧本" },
  { value: "graphics", label: "美术" },
  { value: "music", label: "音乐" },
  { value: "planning", label: "策划" },
  { value: "programming", label: "程序" },
  { value: "other", label: "其他" },
] satisfies { value: StaffCredit["roleKey"]; label: string }[];

export function isExtraStaffRole(
  value: unknown,
): value is Exclude<StaffCredit["roleKey"], "author" | "translator"> {
  return EXTRA_STAFF_ROLES.some((role) => role.value === value);
}
