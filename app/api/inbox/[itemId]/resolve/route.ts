import { requirePermission } from "@/lib/server/auth/authorize";
import { resolveRoleRequest } from "@/lib/server/db/permissions";
import { readRequiredFormString, redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    itemId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePermission(request, "inbox.role_request.resolve");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { itemId: rawItemId } = await context.params;
    const decision = readRequiredFormString(await request.formData(), "decision");

    if (decision !== "approve" && decision !== "reject") {
      throw new Error("Invalid decision");
    }

    await resolveRoleRequest({
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
