import { requireUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    return json({ unread: await countUnreadInboxItemsForUser(auth.user) });
  } catch (error) {
    return jsonError("Inbox unread count failed", error);
  }
}
