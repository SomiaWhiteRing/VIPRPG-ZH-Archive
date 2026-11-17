import type { InboxItem } from "@/lib/dto/db/inbox";
import { translate } from "@/lib/i18n/core";
import type { UiLocale } from "@/lib/i18n/locale";

const closureReasons = [
  { stored: "该角色已停用，申请已关闭。", key: "inbox.roleClosure.disabled" },
  { stored: "此权限已向所有用户开放，无需申请。", key: "inbox.roleClosure.available" },
  { stored: "该角色已关闭开放申请，本次申请已关闭。", key: "inbox.roleClosure.applicationsDisabled" },
] as const;

export function inboxClosureReason(item: InboxItem, locale: UiLocale): string | null {
  if (item.type !== "role_change_request") return item.closedReason;
  const reason = closureReasons.find(({ stored }) => item.closedReason === stored);
  return reason ? translate(locale, reason.key) : item.closedReason;
}

export function inboxItemBody(item: InboxItem, locale: UiLocale): string {
  if (!item.roleRequestClosed) return item.body;
  for (const { key, stored } of closureReasons) {
    const suffix = `：${stored}`;
    if (item.body.endsWith(suffix)) {
      return translate(locale, "inbox.roleClosure.notice", {
        role: item.body.slice(0, -suffix.length),
        reason: translate(locale, key),
      });
    }
  }
  return item.body;
}

export function inboxItemTitle(item: InboxItem, locale: UiLocale): string {
  if (item.roleRequestClosed) return translate(locale, "inbox.roleRequestClosed");
  if (item.type === "role_change_notice") return translate(locale, "inbox.roleChangedTitle");
  return item.type === "role_change_request" && item.requestedRole?.name
    ? translate(locale, "inbox.roleRequestTitle", { role: item.requestedRole.name })
    : item.title;
}

export function maintainerOutcomeCopy(item: InboxItem, locale: UiLocale) {
  const outcome = item.maintainerOutcome;
  if (!outcome) return null;
  const approved = outcome.decision === "approve";
  return {
    title: translate(locale, approved ? "inbox.outcome.approved" : "inbox.outcome.rejected"),
    body: translate(locale, approved ? "inbox.outcome.approvedBody" : "inbox.outcome.rejectedBody", { title: outcome.workTitle }),
  };
}

export function notificationExcerpt(notification: NonNullable<InboxItem["commentNotification"] | InboxItem["timelineNotification"]>, locale: UiLocale) {
  const image = notification.imageExcerpt;
  return image ? image.text + translate(locale, "inbox.excerpt.images", { count: image.count }) : notification.excerpt;
}
