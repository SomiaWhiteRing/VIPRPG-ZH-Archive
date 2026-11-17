import { useMessages } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";

import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { notifyInboxChanged } from "@/lib/inbox-events";
import { createRef, useId, useState, useTransition } from "react";
import { useRevalidator } from "react-router";
import { useConfirm } from '@/app/components/ui/confirm-provider';
import type { InboxItem } from '@/lib/dto/db/inbox';
import { FormField } from '@/app/components/ui/form-field';
import { Textarea } from '@/app/components/ui/textarea';
import { MAX_REJECTION_REASON_LENGTH, normalizeRejectionReason } from '@/lib/inbox';

type InboxAction = 'read' | 'approve' | 'reject' | 'withdraw' | 'friend';

export function InboxActions({
  item,
  all = false,
}: {
  item?: {
    id: number;
    readAt: string | null;
    canApprove: boolean;
    canReject: boolean;
    maintainerRequest?: InboxItem['maintainerRequest'];
    friendNotification?: InboxItem['friendNotification'];
    title?: string;
    targetDisplayName?: string | null;
  };
  all?: boolean;
}) {
  const t = useMessages();
  const revalidator = useRevalidator();
  const toast = useToast();
  const confirm = useConfirm();
  const reasonInputId = useId();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const disabled = busy || refreshing;
  async function act(action: InboxAction) {
    if (disabled) return;
    setBusy(true);
    try {
      if (action === 'reject') {
        const request = item?.maintainerRequest;
        const reasonInput = createRef<HTMLTextAreaElement>();
        await confirm(request
          ? t("inbox.action.rejectMaintainer", { name: request.applicant.displayName, work: request.workTitle })
          : t("inbox.action.rejectPermission", { name: item?.targetDisplayName ?? t("inbox.action.applicant"), title: item?.title ?? t("account.nav.permissions") }), {
          title: request ? t("inbox.action.rejectMaintainerTitle") : t("inbox.action.rejectPermissionTitle"), confirmLabel: t("inbox.action.confirmReject"), destructive: true,
          content: <FormField controlId={reasonInputId} label={t("inbox.action.reason")} hint={t("inbox.action.reasonHint", { max: MAX_REJECTION_REASON_LENGTH })}>
            <Textarea ref={reasonInput} id={reasonInputId} name="rejection_reason" maxLength={MAX_REJECTION_REASON_LENGTH}
              rows={4} aria-describedby={`${reasonInputId}-hint`} placeholder={t("inbox.action.reasonPlaceholder")} />
          </FormField>,
          action: async () => {
            let reason: string;
            try { reason = normalizeRejectionReason(reasonInput.current?.value); }
            catch (error) { reasonInput.current?.focus(); throw error; }
            await perform('reject', reason);
          },
        });
        return;
      }
      if (item?.maintainerRequest && action !== 'read') {
        const request = item.maintainerRequest;
        const accepted = await confirm(action === 'approve'
          ? [t("inbox.action.approveMaintainer", { name: request.applicant.displayName, work: request.workTitle }), t("work.maintainer.grant")].join("\n\n")
          : t("inbox.action.withdrawMaintainer", { work: request.workTitle }),
        { title: action === 'approve' ? t("inbox.action.approveTitle") : t("inbox.action.withdrawTitle"),
          confirmLabel: action === 'approve' ? t("inbox.action.confirmApprove") : t("inbox.action.confirmWithdraw"), destructive: action !== 'approve' });
        if (!accepted) return;
      }
      await perform(action);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure : t("core.confirm.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function perform(action: InboxAction, rejectionReason?: string) {
    if (action === 'friend') {
      const friend = item?.friendNotification;
      if (!friend?.canFollow || friend.userId === null) throw new Error(t("inbox.action.friendUnavailable"));
      await requestJson(`/api/users/${friend.userId}/follow`, { method: 'PUT' });
    } else {
      const data = new FormData();
      if (action !== "read") data.set("decision", action);
      if (action === 'reject') data.set('rejection_reason', rejectionReason ?? '');
      if (item?.maintainerRequest) data.set('confirm', '1');
      const url = all
        ? "/api/inbox/read-all"
        : `/api/inbox/${item!.id}/${action === "read" ? "read" : "resolve"}`;

      try {
        await requestJson(url, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: data,
        });
      } catch (error) {
        if (error instanceof ApiResponseError && error.status === 409) {
          notifyInboxChanged();
          document.getElementById("inbox-controls")?.focus({ preventScroll: true });
          startTransition(() => revalidator.revalidate());
        }
        throw error;
      }
    }
      notifyInboxChanged();
      toast.success(
        action === 'friend' ? t("inbox.action.friendAccepted") : action === "read"
          ? all
            ? t("inbox.action.allRead")
            : item?.friendNotification?.kind === 'added' ? t("inbox.action.friendIgnored") : t("inbox.action.readDone")
          : action === "approve"
            ? t("inbox.action.approved")
            : action === 'withdraw' ? t("inbox.action.withdrawn") : t("inbox.action.rejected"),
      );
      document.getElementById("inbox-controls")?.focus({ preventScroll: true });
      startTransition(() => revalidator.revalidate());
  }
  return (
    <div className="min-w-0" aria-busy={disabled}>
      <div className="flex flex-wrap items-center gap-2">
        {item?.friendNotification?.kind === 'added' ? (
          item.friendNotification.isFollowing ? <span className="text-sm text-accent">{t("inbox.action.accepted")}</span> :
          item.friendNotification.canFollow ? <Button size="sm" disabled={disabled} onClick={() => void act('friend')}>{t("inbox.action.accept")}</Button> : null
        ) : null}
        {item?.canApprove ? (
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => void act("approve")}
          >
            {t("inbox.action.approve")}
          </Button>
        ) : null}
        {item?.canReject ? (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void act("reject")}
          >
            {t("inbox.action.reject")}
          </Button>
        ) : null}
        {item?.maintainerRequest?.canWithdraw ? <Button size="sm" variant="outline" disabled={disabled} onClick={() => void act('withdraw')}>{t("inbox.action.withdraw")}</Button> : null}
        {all || (item && !item.readAt) ? (
          <Button
            size="sm"
            variant={all ? "outline" : "ghost"}
            disabled={disabled}
            onClick={() => void act("read")}
          >
            {all ? t("inbox.action.markAll") : item?.friendNotification?.kind === 'added' ? t("inbox.action.ignore") : t("inbox.action.markRead")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
