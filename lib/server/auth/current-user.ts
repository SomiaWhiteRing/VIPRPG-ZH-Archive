import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, readSessionFromCookieHeader, type SessionIdentity } from "@/lib/server/auth/session";
import { type ArchiveUser, findUserById } from "@/lib/server/db/users";

export type AuthContext = {
  session: SessionIdentity;
  user: ArchiveUser;
  roleKeys: readonly string[];
  permissionKeys: ArchiveUser["permissionKeys"];
  maxRolePriority: number;
  isBootstrapAdmin: boolean;
};

export async function getAuthContextFromRequest(request: Request): Promise<AuthContext | null> {
  return loadAuthContext(await readSessionFromCookieHeader(request.headers.get("cookie")));
}

export async function getAuthContextFromCookies(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return loadAuthContext(await readSessionFromCookieHeader(token ? `${SESSION_COOKIE_NAME}=${token}` : null));
}

export async function getCurrentUserFromRequest(request: Request): Promise<ArchiveUser | null> {
  return (await getAuthContextFromRequest(request))?.user ?? null;
}

export async function getCurrentUserFromCookies(): Promise<ArchiveUser | null> {
  return (await getAuthContextFromCookies())?.user ?? null;
}

async function loadAuthContext(session: SessionIdentity | null): Promise<AuthContext | null> {
  if (!session) return null;
  const user = await findUserById(session.userId);
  if (!user || user.status !== "active") return null;
  return {
    session,
    user,
    roleKeys: user.roleKeys,
    permissionKeys: user.permissionKeys,
    maxRolePriority: user.maxRolePriority,
    isBootstrapAdmin: user.isBootstrapAdmin,
  };
}
