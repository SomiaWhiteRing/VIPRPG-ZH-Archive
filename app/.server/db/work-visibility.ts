import { getCurrentUser } from "@/app/.server/auth/current-user";
import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import type { AppRuntime } from "@/app/.server/runtime";
import { hasPermission } from "@/lib/authz/permissions";
import type { ArchiveUser } from "@/lib/dto/db/user-access";

/** Public indexes never include private works, including for their maintainers. */
export async function listedWorksSource(runtime: AppRuntime): Promise<"public_works" | "member_works"> {
  return await getCurrentUser(runtime) ? "member_works" : "public_works";
}

/** Keep authorization in the same query that reads the protected work. */
export function workReadCondition(user: ArchiveUser | null, alias = "w") {
  return {
    sql: workReadSql(alias, "?=1", "?=1", "?"),
    binds: [user ? 1 : 0, hasPermission(user, "work.read_private") ? 1 : 0, user?.id ?? 0],
  };
}

/** The recipient is a trusted SQL expression, never an interpolated request value. */
export function workReadByUserSql(userId: string, alias = "w"): string {
  return workReadSql(alias,
    `EXISTS(SELECT 1 FROM users access_user WHERE access_user.id=${userId} AND access_user.status='active')`,
    userPermissionSql(userId, "work.read_private"), userId);
}

function workReadSql(alias: string, member: string, privatePermission: string, userId: string): string {
  return `(${alias}.status='published' AND (
    ${alias}.audience='public' OR (${alias}.audience='members' AND ${member})
    OR ${privatePermission} OR EXISTS(SELECT 1 FROM work_uploaders access_owner
      WHERE access_owner.work_id=${alias}.id AND access_owner.user_id=${userId})))`;
}

export async function canReadWork(runtime: AppRuntime, workId: number): Promise<boolean> {
  const access = workReadCondition(await getCurrentUser(runtime));
  return !!await runtime.db.prepare(`SELECT 1 FROM works w WHERE w.id=? AND ${access.sql}`)
    .bind(workId, ...access.binds).first();
}
