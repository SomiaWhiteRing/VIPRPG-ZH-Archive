import { parsePositiveId } from "@/app/.server/http/request";
import { requirePermission } from "@/app/.server/auth/authorize";
import { setUserStatusForAdmin } from "@/app/.server/db/users";
import { redirectResponse } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import type { UserStatus } from "@/lib/dto/db/user-access";
import { json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    userId: string;
  };
};

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requirePermission(runtime, request, "user.status.update");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { userId: rawUserId } = await context.params;
    const userId = parsePositiveId(rawUserId, "id", "Invalid user id");
    const formData = await request.formData();
    const status = parseStatus(String(formData.get("status") ?? ""));
    const user = await setUserStatusForAdmin(runtime, {
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

function parseStatus(value: string): UserStatus {
  if (value === "active" || value === "disabled") {
    return value;
  }

  throw new Error("Invalid user status");
}
