import { requireUser } from "@/lib/server/auth/guards";
import { hasUploaderAccess } from "@/lib/authz/permissions";
import { requestUploaderRole } from "@/lib/server/db/permissions";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser(request);

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

    const item = await requestUploaderRole(auth.user);

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
