import { requestJson } from "@/lib/ui/api-response";

import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { notifyInboxChanged } from "@/lib/inbox-events";
import { createRef, useId, useState, useTransition } from "react";
import { useRevalidator } from "react-router";
import { useConfirm } from '@/app/components/ui/confirm-provider';
import { MAINTAINER_GRANT_DESCRIPTION } from '@/lib/work-maintainers';
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
          ? `确定驳回“${request.applicant.displayName}”对《${request.workTitle}》的维护申请？申请人不会获得维护资格，30 天内不能再次申请本作；维护者仍可主动添加。`
          : `确定驳回“${item?.targetDisplayName ?? '申请人'}”的${item?.title ?? '权限申请'}？申请人不会获得本次申请的权限。`, {
          title: request ? '驳回维护申请？' : '驳回权限申请？', confirmLabel: '确认驳回', destructive: true,
          content: <FormField controlId={reasonInputId} label="驳回理由（选填）" hint={`填写后申请人会看到此理由，最多 ${MAX_REJECTION_REASON_LENGTH} 字。`}>
            <Textarea ref={reasonInput} id={reasonInputId} name="rejection_reason" maxLength={MAX_REJECTION_REASON_LENGTH}
              rows={4} aria-describedby={`${reasonInputId}-hint`} placeholder="可说明未通过申请的原因。" />
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
          ? `确定通过“${request.applicant.displayName}”对《${request.workTitle}》的维护申请？\n\n${MAINTAINER_GRANT_DESCRIPTION}`
          : `确定撤回对《${request.workTitle}》的维护申请？撤回后维护者将无法通过这条申请，30 天内不能再次申请本作。`,
        { title: action === 'approve' ? '通过维护申请？' : '撤回维护申请？',
          confirmLabel: action === 'approve' ? '确认通过' : '确认撤回', destructive: action !== 'approve' });
        if (!accepted) return;
      }
      await perform(action);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  async function perform(action: InboxAction, rejectionReason?: string) {
    if (action === 'friend') {
      const friend = item?.friendNotification;
      if (!friend?.canFollow || friend.userId === null) throw new Error('这位用户暂时无法加为好友。');
      await requestJson(`/api/users/${friend.userId}/follow`, { method: 'PUT' });
    } else {
      const data = new FormData();
      if (action !== "read") data.set("decision", action);
      if (action === 'reject') data.set('rejection_reason', rejectionReason ?? '');
      if (item?.maintainerRequest) data.set('confirm', '1');
      const url = all
        ? "/api/inbox/read-all"
        : `/api/inbox/${item!.id}/${action === "read" ? "read" : "resolve"}`;

      await requestJson(url, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: data,
      });
    }
      notifyInboxChanged();
      toast.success(
        action === 'friend' ? '已加为好友。' : action === "read"
          ? all
            ? "已将全部提醒标记为已读。"
            : item?.friendNotification?.kind === 'added' ? '已忽略这条好友提醒。' : "已标记为已读。"
          : action === "approve"
            ? "申请已通过。"
            : action === 'withdraw' ? '申请已撤回。' : "申请已驳回。",
      );
      document.getElementById("inbox-controls")?.focus({ preventScroll: true });
      startTransition(() => revalidator.revalidate());
  }
  return (
    <div className="min-w-0" aria-busy={disabled}>
      <div className="flex flex-wrap items-center gap-2">
        {item?.friendNotification?.kind === 'added' ? (
          item.friendNotification.isFollowing ? <span className="text-sm text-muted">已加为好友</span> :
          item.friendNotification.canFollow ? <Button size="sm" disabled={disabled} onClick={() => void act('friend')}>加为好友</Button> : null
        ) : null}
        {item?.canApprove ? (
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => void act("approve")}
          >
            通过
          </Button>
        ) : null}
        {item?.canReject ? (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void act("reject")}
          >
            驳回
          </Button>
        ) : null}
        {item?.maintainerRequest?.canWithdraw ? <Button size="sm" variant="outline" disabled={disabled} onClick={() => void act('withdraw')}>撤回申请</Button> : null}
        {all || (item && !item.readAt) ? (
          <Button
            size="sm"
            variant={all ? "outline" : "ghost"}
            disabled={disabled}
            onClick={() => void act("read")}
          >
            {all ? "全部标记已读" : item?.friendNotification?.kind === 'added' ? "忽略" : "标记已读"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
