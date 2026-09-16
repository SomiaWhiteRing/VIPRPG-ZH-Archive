import { requireUser } from "@/app/.server/auth/guards";
import { requestUploaderRole } from "@/app/.server/db/permissions";
import { redirectResponse } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { hasUploaderAccess } from "@/lib/authz/permissions";
import { json, jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requireUser(runtime, request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    if (hasUploaderAccess(auth.user)) {
      if (!request.headers.get("accept")?.includes("application/json")) {
        return redirectResponse(new URL("/inbox", request.url));
      }

      return json({
        ok: true,
        alreadyGranted: true,
        roleKeys: auth.user.roleKeys,
      });
    }

    const item = await requestUploaderRole(runtime, auth.user);

    if (!request.headers.get("accept")?.includes("application/json")) {
      return redirectResponse(new URL("/inbox", request.url));
    }

    return json({
      ok: true,
      inboxItem: {
        id: item.id,
        status: item.status,
        requestedRole: item.requestedRole,
      },
    });
  } catch (error) {
    return jsonError("Upload access request failed", error);
  }
}
