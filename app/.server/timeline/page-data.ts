import { redirect } from "react-router";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { listTimeline, readTimelineSettings } from "@/app/.server/db/timeline";
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
  const view = query.get("view") ?? settings?.defaultView ?? "all";
  if (!isTimelineView(view)) throw new Response("时间线范围无效", { status: 400 });
  if (view !== "all" && !viewer) await requireAccountUser(runtime, url.pathname + url.search);
  const kind = TIMELINE_FILTER_KINDS.find((value) => value === query.get("kind"));
  const cursor = query.has("kind") && !kind ? null : query.get("cursor");
  let page;
  try {
    page = await listTimeline(runtime, { viewerId: viewer?.id, actorUserId: view === "mine" ? viewer?.id : undefined, following: view === "following", kind, cursor });
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== "timeline_cursor_changed") throw error;
    query.delete("cursor");
    throw redirect(url.pathname + (query.size ? `?${query}` : ""));
  }
  const topics = await homeTopics(getForumRuntime(runtime));
  return {
    page,
    viewerId: viewer?.id ?? null,
    viewer: pickPageFields(viewer, ["id", "displayName", "avatarBlobSha256"]),
    topics,
    canPublish: !!viewer && hasPermission(viewer, "timeline.use") && hasPermission(viewer, "timeline.status.create"),
    settings, view, kind, hasCursor: !!cursor,
  };
}

export type TimelinePageData = Awaited<ReturnType<typeof readTimelinePage>>;
