import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";

import { useRef, useState } from "react";
import { Mail } from "lucide-react";
import { useRevalidator } from "react-router";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import type { FollowSummary } from "@/lib/dto/db/user-follows";
import { notifyInboxChanged } from "@/lib/inbox-events";
import { UserBlockButton } from "@/app/components/user-block-settings";
import type { RestrictedInteraction } from "@/lib/interaction-restrictions";
import type { UserBlockSettings } from "@/lib/user-blocks";

export function UserFollowControls({ userId, displayName, viewerId, summary, canMessage = false, blockSettings, interactionRestrictions, avatarBlobSha256 }: {
  userId: number; displayName: string; viewerId: number | null; summary: FollowSummary | null; canMessage?: boolean;
  blockSettings: UserBlockSettings | null; interactionRestrictions: RestrictedInteraction[] | null; avatarBlobSha256: string | null;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const revalidator = useRevalidator();
  const toast = useToast();
  const confirm = useConfirm();
  async function save(following: boolean) {
    setBusy(true);
    try {
      await requestJson(`/api/users/${userId}/follow?${UI_LOCALE_PARAM}=${locale}`, { method: following ? "PUT" : "DELETE" }, t("friends.failed"));
      notifyInboxChanged();
      await revalidator.revalidate();
    } finally { setBusy(false); }
  }
  async function toggle() {
    if (!summary || submitting.current) return;
    submitting.current = true;
    try {

      if (summary.isFollowing) await confirm(t("friends.confirm", { name: displayName }), {
        title: t("friends.remove"), confirmLabel: t("friends.remove"), destructive: true, action: () => save(false),
      });
      else await save(true);
    } catch (error) {
      toast.error(error instanceof ApiResponseError ? error.messageFor(locale) : error instanceof Error ? error.message : t("friends.failed"));
    } finally { submitting.current = false; }
  }
  if (!summary || viewerId === userId) return null;
  return <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
    {!viewerId ? <Button asChild size="sm"><Link to={`/login?next=${encodeURIComponent(`/users/${userId}`)}`}>{t("friends.add")}</Link></Button> :
      <Button type="button" size="sm" variant={summary.isFollowing ? "outline" : "default"}
        disabled={busy || (summary.isFollowing ? !summary.canUnfollow : !summary.canFollow)} onClick={() => void toggle()}>
        {busy ? t("admin.discussionTags.saving") : summary.isFollowing ? t("friends.remove") : t("friends.add")}
      </Button>}
    {canMessage ? <Button asChild size="sm" variant="outline" className="w-9 px-0"><Link to={`/me/messages/${userId}`} aria-label={t("friends.message")} title={t("friends.message")}><Mail aria-hidden /></Link></Button> : null}
    {blockSettings ? <UserBlockButton peer={{ id: userId, displayName, avatarBlobSha256 }} initial={blockSettings} interactionRestrictions={interactionRestrictions} /> : null}
  </div>;
}
