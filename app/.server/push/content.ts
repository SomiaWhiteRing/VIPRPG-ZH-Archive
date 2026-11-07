import { parseTimestamp } from "@/lib/format";
import type { AppRuntime } from "@/app/.server/runtime";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { getInboxItemForUser, inboxTargetLocation } from "@/app/.server/db/inbox";
import type { InboxItem } from "@/lib/dto/db/inbox";
import { getUserAvatarSrc } from "@/lib/user-profile";
import { emojiText } from "@/lib/face-emojis";
import { hasPermission } from "@/lib/authz/permissions";
import type { PushNotificationContent } from "@/lib/push";
import { HttpError } from "@/lib/http";

export async function webPushContent(runtime: AppRuntime, user: ArchiveUser, kind: "inbox" | "messages", id: number,
  includeActions = true): Promise<PushNotificationContent | null> {
  const content: PushNotificationContent = { id: `${kind}:${id}`, userId: user.id, group: kind,
    title: "VIPRPG.org", body: "", icon: "/icon/windI.png", url: "", timestamp: 0, actions: [] };
  if (kind === "messages") {
    const message = await runtime.db.prepare(`SELECT m.body,m.kind,m.created_at,m.sender_user_id,u.display_name,u.avatar_blob_sha256
      FROM direct_messages m JOIN users u ON u.id=m.sender_user_id AND u.status='active'
      WHERE m.id=? AND m.recipient_user_id=? AND m.delivered=1`)
      .bind(id, user.id).first<{ body: string | null; kind: string; created_at: string; sender_user_id: number; display_name: string; avatar_blob_sha256: string | null }>();
    if (!message) return null;
    content.title = `${message.display_name}发来了私信`;
    content.body = message.kind === "image" ? "［图片］" : emojiText(message.body ?? "");
    content.icon = getUserAvatarSrc(message.avatar_blob_sha256);
    content.timestamp = parseTimestamp(message.created_at).getTime();
    content.url = `/me/messages/${message.sender_user_id}`;
    if (includeActions && hasPermission(user, "message.send") && await runtime.db.prepare(`SELECT 1 FROM users WHERE id=? AND receive_private_messages=1`)
      .bind(message.sender_user_id).first()) content.actions.push({ action: "reply", title: "回复", url: `${content.url}?pushReply=1` });
  } else {
    let item;
    try { item = await getInboxItemForUser(runtime, id, user); }
    catch (error) { if (error instanceof HttpError && error.status === 404) return null; throw error; }
    const actor = item.interaction ?? item.timelineNotification ?? item.commentNotification ?? item.friendNotification;
    const source = item.interaction ?? item.timelineNotification ?? item.commentNotification;
    if (item.contentUnavailable) return null;
    content.title = actor ? actor.actorName + actor.action : item.title;
    content.body = source ? `${"topicTitle" in source ? source.topicTitle : source.targetTitle}\n${source.excerpt}`
      : item.maintainerRequest ? `${item.maintainerRequest.applicant.displayName} · ${item.maintainerRequest.workTitle}\n${item.body}` : item.body;
    const avatar = actor?.actorAvatar ?? item.maintainerRequest?.applicant.avatarBlobSha256 ?? item.senderAvatar;
    content.icon = avatar || actor || item.maintainerRequest || item.senderDisplayName ? getUserAvatarSrc(avatar) : "/icon/windI.png";
    content.timestamp = parseTimestamp(item.createdAt).getTime();
    content.url = `/inbox/${id}`;
    if (includeActions && item.friendNotification?.kind === "added" && !item.friendNotification.isFollowing) {
      if (item.friendNotification.canFollow) content.actions.push({ action: "friend-accept", title: "同意" });
      content.actions.push({ action: "friend-ignore", title: "忽略" });
    } else if (includeActions && ((item.commentNotification && item.commentNotification.kind !== "like")
      || (item.timelineNotification?.kind === "reply" && hasPermission(user, "timeline.reply.create"))
      || (item.interaction?.replyAllowed && item.type === "forum_reply" && hasPermission(user, "forum.use")))) {
      const replyUrl = await webPushReplyLocation(runtime, item);
      if (replyUrl) content.actions.push({ action: "reply", title: "回复", url: replyUrl });
    }
  }
  content.title = content.title.slice(0, 100);
  content.body = content.body.slice(0, 240);
  return content;
}

export async function webPushReplyLocation(runtime: AppRuntime, item: InboxItem) {
  const location = await inboxTargetLocation(runtime, item);
  if (!location) return null;
  const url = new URL(location.href, runtime.origin);
  if (item.interaction) url.searchParams.set("reply", item.interaction.postNumber === 1 ? "topic" : String(item.interaction.postNumber));
  else url.searchParams.set("pushReply", String(item.timelineNotification?.eventId ?? item.id));
  url.searchParams.set("inbox", String(item.id));
  return url.pathname + url.search + url.hash;
}
