import { requireUser } from "@/app/.server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/app/.server/db/inbox";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    return json({
      unread: await countUnreadInboxItemsForUser(runtime, auth.user),
    });
  } catch (error) {
    return jsonError("Inbox unread count failed", error);
  }
}
