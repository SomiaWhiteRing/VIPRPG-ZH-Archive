import { cache } from "react";
import { cookies } from "next/headers";
import { getSessionHashFromCookieHeader, SESSION_COOKIE_NAME, type SessionIdentity } from "@/lib/server/auth/session";
import { type ArchiveUser, findActiveUserBySessionHash } from "@/lib/server/db/users";

export type AuthContext = {
  session: SessionIdentity;
  user: ArchiveUser;
  roleKeys: readonly string[];
  permissionKeys: ArchiveUser["permissionKeys"];
  maxRolePriority: number;
  isBootstrapAdmin: boolean;
};

export const getAuthContextFromRequest = cache(async (request: Request): Promise<AuthContext | null> =>
  loadAuthContext(await getSessionHashFromCookieHeader(request.headers.get("cookie")))
);

export const getAuthContextFromCookies = cache(async (): Promise<AuthContext | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return loadAuthContext(await getSessionHashFromCookieHeader(token ? `${SESSION_COOKIE_NAME}=${token}` : null));
});

export async function getCurrentUserFromRequest(request: Request): Promise<ArchiveUser | null> {
  return (await getAuthContextFromRequest(request))?.user ?? null;
}

export async function getCurrentUserFromCookies(): Promise<ArchiveUser | null> {
  return (await getAuthContextFromCookies())?.user ?? null;
}

async function loadAuthContext(sessionHash: string | null): Promise<AuthContext | null> {
  if (!sessionHash) return null;
  const match = await findActiveUserBySessionHash(sessionHash);
  if (!match) return null;
  const session: SessionIdentity = { id: match.sessionId, userId: match.user.id };
  const user = match.user;
  return {
    session,
    user,
    roleKeys: user.roleKeys,
    permissionKeys: user.permissionKeys,
    maxRolePriority: user.maxRolePriority,
    isBootstrapAdmin: user.isBootstrapAdmin,
  };
}
