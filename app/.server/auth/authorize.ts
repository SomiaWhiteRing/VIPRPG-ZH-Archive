import type { AuthContext } from "@/app/.server/auth/current-user";
import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { redirectPage } from "@/app/.server/http/page-response";
import type { AppRuntime } from "@/app/.server/runtime";
import type { PermissionKey } from "@/lib/authz/permissions";
import { hasPermission } from "@/lib/authz/permissions";
import { json } from "@/lib/http";

type AuthFailure = { response: Response };
type AuthSuccess = { user: AuthContext["user"] };
type RequestAuth = { context: AuthContext } | AuthFailure;

export async function requirePermission(
  runtime: AppRuntime,
  request: Request,
  permission: PermissionKey,
): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireRequestContext(runtime, request);
  if ("response" in auth) return auth;
  if (!hasPermission(auth.context.user, permission)) return permissionDenied();
  return { user: auth.context.user };
}

export async function requireAnyPermission(
  runtime: AppRuntime,
  request: Request,
  permissions: readonly PermissionKey[],
): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireRequestContext(runtime, request);
  if ("response" in auth) return auth;
  if (
    !permissions.some((permission) =>
      hasPermission(auth.context.user, permission),
    )
  )
    return permissionDenied();
  return { user: auth.context.user };
}

export async function requireBootstrapAdmin(
  runtime: AppRuntime,
  request: Request,
): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireRequestContext(runtime, request);
  if ("response" in auth) return auth;
  if (!auth.context.isBootstrapAdmin) return permissionDenied();
  return { user: auth.context.user };
}

async function requireRequestContext(
  runtime: AppRuntime,
  request: Request,
): Promise<RequestAuth> {
  try {
    assertSameOrigin(runtime, request);
  } catch (error) {
    if (!(error instanceof SameOriginError)) throw error;
    return {
      response: json({ ok: false, error: error.message }, { status: 403 }),
    };
  }

  const context = await getAuthContext(runtime);
  if (!context)
    return {
      response: json(
        { ok: false, error: "Authentication required" },
        { status: 401 },
      ),
    };
  return { context };
}

function permissionDenied(): AuthFailure {
  return {
    response: json({ ok: false, error: "Permission denied" }, { status: 403 }),
  };
}

async function requirePageContext(
  runtime: AppRuntime,
  nextPath: string,
): Promise<AuthContext> {
  const context = await getAuthContext(runtime);
  const safePath = sanitizeRedirectPath(nextPath);
  if (!context) redirectPage(`/login?next=${encodeURIComponent(safePath)}`);
  return context;
}

export async function requirePagePermission(
  runtime: AppRuntime,
  nextPath: string,
  permission: PermissionKey,
) {
  const context = await requirePageContext(runtime, nextPath);
  if (!hasPermission(context.user, permission)) redirectPage("/");
  return context.user;
}

export async function requireAnyPagePermission(
  runtime: AppRuntime,
  nextPath: string,
  permissions: readonly PermissionKey[],
) {
  const context = await requirePageContext(runtime, nextPath);
  if (
    !permissions.some((permission) => hasPermission(context.user, permission))
  )
    redirectPage("/");
  return context.user;
}

export async function requireBootstrapAdminPage(
  runtime: AppRuntime,
  nextPath: string,
) {
  const context = await requirePageContext(runtime, nextPath);
  if (!context.isBootstrapAdmin) redirectPage("/");
  return context.user;
}
