import { requireAdmin } from "@/lib/server/auth/guards";
import { isUserRole } from "@/lib/server/auth/roles";
import { changeUserRole } from "@/lib/server/db/inbox";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { userId: rawUserId } = await context.params;
    const userId = parseUserId(rawUserId);
    const formData = await request.formData();
    const role = String(formData.get("role") ?? "");

    if (!isUserRole(role)) {
      throw new Error("Invalid role");
    }

    const user = await changeUserRole({
      actor: auth.user,
      targetUserId: userId,
      newRole: role,
      reason: "admin_role_update",
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      });
    }

    return redirectResponse(new URL("/admin/users", request.url));
  } catch (error) {
    return jsonError("User role update failed", error);
  }
}

function parseUserId(value: string): number {
  const userId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Invalid user id");
  }

  return userId;
}
