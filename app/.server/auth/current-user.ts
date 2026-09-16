import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { AppRuntime } from "../runtime";
import { memoizeRequest } from "../runtime";
import { loadRequestSession } from "./request-auth";
import type { SessionIdentity } from "./session";
export type AuthContext = {
  session: SessionIdentity;
  user: ArchiveUser;
  roleKeys: readonly string[];
  permissionKeys: ArchiveUser["permissionKeys"];
  maxRolePriority: number;
  isBootstrapAdmin: boolean;
};
export function getAuthContext(
  runtime: AppRuntime,
): Promise<AuthContext | null> {
  return memoizeRequest(runtime, "auth", async () => {
    const match = await loadRequestSession(
      runtime.db,
      runtime.request.headers.get("cookie"),
    );
    if (!match) return null;
    const user = match.user;
    return {
      session: { id: match.sessionId, userId: user.id },
      user,
      roleKeys: user.roleKeys,
      permissionKeys: user.permissionKeys,
      maxRolePriority: user.maxRolePriority,
      isBootstrapAdmin: user.isBootstrapAdmin,
    };
  });
}
export async function getCurrentUser(
  runtime: AppRuntime,
): Promise<ArchiveUser | null> {
  return (await getAuthContext(runtime))?.user ?? null;
}
