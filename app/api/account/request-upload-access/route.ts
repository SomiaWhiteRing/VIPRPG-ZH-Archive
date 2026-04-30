import { requireUser } from "@/lib/server/auth/guards";
import { canUploadRole } from "@/lib/server/auth/roles";
import { createUploadRoleRequest } from "@/lib/server/db/inbox";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    if (canUploadRole(auth.user.role)) {
      if (!request.headers.get("accept")?.includes("application/json")) {
        return redirectResponse(new URL("/inbox", request.url));
      }

      return json({
        ok: true,
        alreadyGranted: true,
        role: auth.user.role,
      });
    }

    const item = await createUploadRoleRequest(auth.user);

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
