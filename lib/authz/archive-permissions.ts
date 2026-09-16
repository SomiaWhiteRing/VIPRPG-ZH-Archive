import { hasPermission } from "./permissions";
export type ArchiveActor = { id: number } & NonNullable<
  Parameters<typeof hasPermission>[0]
>;
export function canDeleteArchiveVersion(
  actor: ArchiveActor,
  maintainerId: number | null,
): boolean {
  return (
    hasPermission(actor, "archive_version.delete_any") ||
    (hasPermission(actor, "archive_version.delete_own") &&
      maintainerId === actor.id)
  );
}
