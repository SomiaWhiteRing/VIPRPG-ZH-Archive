import { requireUser } from "@/lib/server/auth/guards";
import { markInboxItemRead } from "@/lib/server/db/inbox";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    itemId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { itemId: rawItemId } = await context.params;

    await markInboxItemRead({
      user: auth.user,
      itemId: parseItemId(rawItemId),
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({ ok: true });
    }

    return redirectResponse(new URL("/inbox", request.url));
  } catch (error) {
    return jsonError("Inbox item read failed", error);
  }
}

function parseItemId(value: string): number {
  const itemId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw new Error("Invalid inbox item id");
  }

  return itemId;
}
