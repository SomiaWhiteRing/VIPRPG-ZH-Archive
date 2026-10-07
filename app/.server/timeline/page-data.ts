import { redirect } from "react-router";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { listTimeline, readTimelineSettings } from "@/app/.server/db/timeline";
import { listTimelineReplies } from "@/app/.server/db/timeline-interactions";
import { getInboxItemForUser } from "@/app/.server/db/inbox";
import { parsePageId } from "@/app/.server/http/page-response";
import { getForumRuntime } from "@/app/.server/forum/context";
import { homeTopics } from "@/app/.server/forum/public-queries";
import { pickPageFields } from "@/app/.server/page-data";
import type { AppRuntime } from "@/app/.server/runtime";
import { TIMELINE_FILTER_KINDS, isTimelineView } from "@/lib/dto/db/timeline";
import { hasPermission } from "@/lib/authz/permissions";
import { HttpError } from "@/lib/http";

export async function readTimelinePage(runtime: AppRuntime, url: URL) {
  const viewer = await getCurrentUser(runtime);
  const settings = viewer ? await readTimelineSettings(runtime, viewer.id) : null;
  const query = new URLSearchParams(url.search);
  const eventId = query.has("event") ? parsePageId(query.get("event")!) : undefined;
  const replyId = eventId && query.has("reply") ? parsePageId(query.get("reply")!) : null;
  const view = eventId ? "all" : query.get("view") ?? settings?.defaultView ?? "all";
  if (!isTimelineView(view)) throw new Response("时间线范围无效", { status: 400 });
  if (view !== "all" && !viewer) await requireAccountUser(runtime, url.pathname + url.search);
  const kind = eventId ? "status" : TIMELINE_FILTER_KINDS.find((value) => value === query.get("kind"));
  const cursor = eventId || (query.has("kind") && !kind) ? null : query.get("cursor");
  let page;
  try {
    page = await listTimeline(runtime, { viewerId: viewer?.id, eventId, actorUserId: view === "mine" ? viewer?.id : undefined, following: view === "following", kind, cursor });
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== "timeline_cursor_changed") throw error;
    query.delete("cursor");
    throw redirect(url.pathname + (query.size ? `?${query}` : ""));
  }
  if (eventId && !page.items.length) throw new Response("吐槽不存在或已隐藏", { status: 404 });
  // Start at the addressed reply, even when it is beyond the first page of replies.
  const initialReplies = eventId && replyId ? await listTimelineReplies(runtime, eventId, replyId > 1 ? String(replyId - 1) : null) : undefined;
  if (replyId && !initialReplies?.items.some((reply) => reply.id === replyId)) throw new Response("回复不存在或已隐藏", { status: 404 });
  const inboxId = eventId && viewer && query.has("inbox") ? parsePageId(query.get("inbox")!) : null;
  const inboxItem = inboxId && viewer ? await getInboxItemForUser(runtime, inboxId, viewer).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }) : null;
  const notification = inboxItem?.timelineNotification;
  const inboxItemId = inboxItem && !inboxItem.readAt && notification && notification.eventId === eventId
    && notification.replyId === replyId ? inboxItem.id : undefined;
  const topics = await homeTopics(getForumRuntime(runtime));
  return {
    page,
    viewerId: viewer?.id ?? null,
    viewer: pickPageFields(viewer, ["id", "displayName", "avatarBlobSha256"]),
    topics,
    canPublish: !!viewer && hasPermission(viewer, "timeline.use") && hasPermission(viewer, "timeline.status.create"),
    settings, view, kind, hasCursor: !!cursor, focused: !!eventId, initialReplies, inboxItemId, targetReplyId: replyId,
  };
}

export type TimelinePageData = Awaited<ReturnType<typeof readTimelinePage>>;
