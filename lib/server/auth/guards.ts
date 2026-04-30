import { redirect } from "next/navigation";
import { getCurrentUserFromCookies, getCurrentUserFromRequest } from "@/lib/server/auth/current-user";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
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
          error: "Upload permission has not been approved",
          uploadStatus: auth.user.uploadStatus,
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

  if (auth.user.role !== "admin") {
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

export async function requireAdminPageUser(nextPath: string): Promise<ArchiveUser> {
  const user = await getCurrentUserFromCookies();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(sanitizeRedirectPath(nextPath))}`);
  }

  if (user.role !== "admin") {
    redirect("/");
  }

  return user;
}
