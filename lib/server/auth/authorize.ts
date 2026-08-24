import { redirect } from "next/navigation";
import { hasPermission, type PermissionKey } from "@/lib/authz/permissions";
import { getAuthContextFromCookies, getAuthContextFromRequest, type AuthContext } from "@/lib/server/auth/current-user";
import { assertSameOrigin, SameOriginError } from "@/lib/server/auth/origin";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { json } from "@/lib/server/http/json";

type AuthFailure = { response: Response };
type AuthSuccess = { user: AuthContext["user"] };
type RequestAuth = { context: AuthContext } | AuthFailure;

export async function requirePermission(
  request: Request,
  permission: PermissionKey,
): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireRequestContext(request);
  if ("response" in auth) return auth;
  if (!hasPermission(auth.context.user, permission)) return permissionDenied();
  return { user: auth.context.user };
}

export async function requireAnyPermission(
  request: Request,
  permissions: readonly PermissionKey[],
): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireRequestContext(request);
  if ("response" in auth) return auth;
  if (!permissions.some((permission) => hasPermission(auth.context.user, permission))) return permissionDenied();
  return { user: auth.context.user };
}

export async function requireBootstrapAdmin(request: Request): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireRequestContext(request);
  if ("response" in auth) return auth;
  if (!auth.context.isBootstrapAdmin) return permissionDenied();
  return { user: auth.context.user };
}

async function requireRequestContext(request: Request): Promise<RequestAuth> {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (!(error instanceof SameOriginError)) throw error;
    return { response: json({ ok: false, error: error.message }, { status: 403 }) };
  }

  const context = await getAuthContextFromRequest(request);
  if (!context) return { response: json({ ok: false, error: "Authentication required" }, { status: 401 }) };
  return { context };
}

function permissionDenied(): AuthFailure {
  return { response: json({ ok: false, error: "Permission denied" }, { status: 403 }) };
}

async function requirePageContext(nextPath: string): Promise<AuthContext> {
  const context = await getAuthContextFromCookies();
  const safePath = sanitizeRedirectPath(nextPath);
  if (!context) redirect(`/login?next=${encodeURIComponent(safePath)}`);
  return context;
}

export async function requirePagePermission(nextPath: string, permission: PermissionKey) {
  const context = await requirePageContext(nextPath);
  if (!hasPermission(context.user, permission)) redirect("/");
  return context.user;
}

export async function requireBootstrapAdminPage(nextPath: string) {
  const context = await requirePageContext(nextPath);
  if (!context.isBootstrapAdmin) redirect("/");
  return context.user;
}
