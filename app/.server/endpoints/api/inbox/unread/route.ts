import { requireUser } from "@/app/.server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/app/.server/db/inbox";
import { countUnreadDirectMessages } from "@/app/.server/db/messages";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    return json({
      unread: await countUnreadInboxItemsForUser(runtime, auth.user),
      messagesUnread: await countUnreadDirectMessages(runtime, auth.user.id),
    });
  } catch (error) {
    return jsonError("Inbox unread count failed", error);
  }
}
