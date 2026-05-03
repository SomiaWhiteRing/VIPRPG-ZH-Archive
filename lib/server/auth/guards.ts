import { redirect } from "next/navigation";
import { getCurrentUserFromCookies, getCurrentUserFromRequest } from "@/lib/server/auth/current-user";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import {
  canAccessSuperAdminRole,
  canManageUsersRole,
} from "@/lib/server/auth/roles";
import { json } from "@/lib/server/http/json";
import { type ArchiveUser, canUpload } from "@/lib/server/db/users";

type AuthSuccess = {
  user: ArchiveUser;
};

type AuthFailure = {
  response: Response;
};

export async function requireUser(request: Request): Promise<AuthSuccess | AuthFailure> {
  const user = await getCurrentUserFromRequest(request);

  if (!user) {
    return {
      response: json(
        {
          ok: false,
          error: "Authentication required",
        },
        { status: 401 },
      ),
    };
  }

  return { user };
}

export async function requireUploader(
  request: Request,
): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireUser(request);

  if ("response" in auth) {
    return auth;
  }

  if (!canUpload(auth.user)) {
    return {
      response: json(
        {
          ok: false,
          error: "Uploader role required",
          role: auth.user.role,
        },
        { status: 403 },
      ),
    };
  }

  return auth;
}

export async function requireAdmin(request: Request): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireUser(request);

  if ("response" in auth) {
    return auth;
  }

  if (!canManageUsersRole(auth.user.role)) {
    return {
      response: json(
        {
          ok: false,
          error: "Admin permission required",
        },
        { status: 403 },
      ),
    };
  }

  return auth;
}

export async function requireSuperAdmin(
  request: Request,
): Promise<AuthSuccess | AuthFailure> {
  const auth = await requireUser(request);

  if ("response" in auth) {
    return auth;
  }

  if (!canAccessSuperAdminRole(auth.user.role)) {
    return {
      response: json(
        {
          ok: false,
          error: "Super admin permission required",
        },
        { status: 403 },
      ),
    };
  }

  return auth;
}

export async function requireUploaderPageUser(nextPath: string): Promise<ArchiveUser> {
  const user = await getCurrentUserFromCookies();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(sanitizeRedirectPath(nextPath))}`);
  }

  if (!canUpload(user)) {
    redirect("/");
  }

  return user;
}

export async function requireAdminPageUser(nextPath: string): Promise<ArchiveUser> {
  const user = await getCurrentUserFromCookies();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(sanitizeRedirectPath(nextPath))}`);
  }

  if (!canManageUsersRole(user.role)) {
    redirect("/");
  }

  return user;
}

export async function requireSuperAdminPageUser(nextPath: string): Promise<ArchiveUser> {
  const user = await getCurrentUserFromCookies();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(sanitizeRedirectPath(nextPath))}`);
  }

  if (!canAccessSuperAdminRole(user.role)) {
    redirect("/");
  }

  return user;
}
