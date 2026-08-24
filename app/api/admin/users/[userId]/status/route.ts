import { requirePermission } from "@/lib/server/auth/authorize";
import { setUserStatusForAdmin, type UserStatus } from "@/lib/server/db/users";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePermission(request, "user.status.update");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { userId: rawUserId } = await context.params;
    const userId = parseUserId(rawUserId);
    const formData = await request.formData();
    const status = parseStatus(String(formData.get("status") ?? ""));
    const user = await setUserStatusForAdmin({
      actor: auth.user,
      targetUserId: userId,
      status,
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          roleKeys: user.roleKeys,
          status: user.status,
        },
      });
    }

    return redirectResponse(new URL("/admin/users", request.url));
  } catch (error) {
    return jsonError("User status update failed", error);
  }
}

function parseUserId(value: string): number {
  const userId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Invalid user id");
  }

  return userId;
}

function parseStatus(value: string): UserStatus {
  if (value === "active" || value === "disabled") {
    return value;
  }

  throw new Error("Invalid user status");
}
