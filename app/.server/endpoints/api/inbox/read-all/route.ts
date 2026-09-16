import { requireUser } from "@/app/.server/auth/guards";
import { markAllInboxItemsRead } from "@/app/.server/db/inbox";
import { redirectResponse } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requireUser(runtime, request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const count = await markAllInboxItemsRead(runtime, auth.user);

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({ ok: true, count });
    }

    return redirectResponse(new URL("/inbox", request.url));
  } catch (error) {
    return jsonError("Inbox read-all failed", error);
  }
}
