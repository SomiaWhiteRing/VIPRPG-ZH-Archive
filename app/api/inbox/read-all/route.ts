import { requireUser } from "@/lib/server/auth/guards";
import { markAllInboxItemsRead } from "@/lib/server/db/inbox";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const count = await markAllInboxItemsRead(auth.user);

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({ ok: true, count });
    }

    return redirectResponse(new URL("/inbox", request.url));
  } catch (error) {
    return jsonError("Inbox read-all failed", error);
  }
}
