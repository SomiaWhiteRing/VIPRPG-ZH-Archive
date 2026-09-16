import { requirePermission } from "@/app/.server/auth/authorize";
import { resolveRoleRequest } from "@/app/.server/db/permissions";
import {
  readRequiredFormString,
  redirectResponse,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    itemId: string;
  };
};

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requirePermission(
    runtime,
    request,
    "inbox.role_request.resolve",
  );

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { itemId: rawItemId } = await context.params;
    const decision = readRequiredFormString(
      await request.formData(),
      "decision",
    );

    if (decision !== "approve" && decision !== "reject") {
      throw new Error("Invalid decision");
    }

    await resolveRoleRequest(runtime, {
      actor: auth.user,
      itemId: parseItemId(rawItemId),
      decision,
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({ ok: true });
    }

    return redirectResponse(new URL("/inbox", request.url));
  } catch (error) {
    return jsonError("Inbox request resolution failed", error);
  }
}

function parseItemId(value: string): number {
  const itemId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw new Error("Invalid inbox item id");
  }

  return itemId;
}
