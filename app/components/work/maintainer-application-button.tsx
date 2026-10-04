import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/app/components/ui/button';
import { useConfirm } from '@/app/components/ui/confirm-provider';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import { useToast } from '@/app/components/ui/toast';
import { requestJson } from '@/lib/ui/api-response';
import { MAINTAINER_APPLICATION_DESCRIPTION, type MaintainerApplication } from '@/lib/work-maintainers';
import { notifyInboxChanged } from '@/lib/inbox-events';

export function MaintainerApplicationButton({ workId, initialApplication }: { workId: number; initialApplication: MaintainerApplication }) {
  const [application, setApplication] = useState(initialApplication);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const confirm = useConfirm();
  const toast = useToast();
  const endpoint = `/api/works/${workId}/maintainer-requests`;
  async function apply() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const preview = await requestJson<{ ok: true; application: MaintainerApplication }>(endpoint, { credentials: 'same-origin' }, '读取申请失败');
      setApplication(preview.application);
      if (!preview.application.canApply) throw new Error(preview.application.unavailableReason ?? '暂时无法申请。');
      await confirm(`将向以下作品维护者申请加入，任一维护者通过即可生效。\n\n${MAINTAINER_APPLICATION_DESCRIPTION}`, {
        title: '申请成为作品维护者？', confirmLabel: '确认申请',
        content: <ul aria-label="接收申请的维护者" className="grid min-w-0 grid-cols-1 max-h-60 gap-3 overflow-y-auto">
          {preview.application.recipients.map((person) => <li key={person.id} className="flex min-w-0 items-center gap-2">
            <Link to={`/users/${person.id}`} className="flex min-w-0 items-center gap-2 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-primary">
              <UserAvatar displayName={person.displayName} avatarBlobSha256={person.avatarBlobSha256} size={32} className="size-8 shrink-0" />
              <span className="min-w-0 wrap-anywhere">{person.displayName}</span>
            </Link>
          </li>)}
        </ul>,
        action: async () => {
          const result = await requestJson<{ ok: true; application: MaintainerApplication }>(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true, recipientIds: preview.application.recipients.map((user) => user.id) }),
          }, '提交申请失败');
          setApplication(result.application);
          notifyInboxChanged();
        },
      });
    } catch (error) { toast.error(error instanceof Error ? error.message : '读取申请失败。'); }
    finally { running.current = false; setBusy(false); }
  }
  if (application.request?.status === 'pending') return <Link to={`/inbox/${application.request.inboxItemId}`}
    className="min-w-0 flex-1 shrink px-1 text-center text-sm font-medium text-secondary hover:underline">申请待处理</Link>;
  return <Button type="button" variant="ghost" className="h-auto min-w-0 flex-1 shrink px-1 py-0 text-sm text-secondary hover:underline"
    disabled={busy} onClick={() => void apply()}>申请维护</Button>;
}
