import { useRef, useState } from 'react';
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { Button } from '@/app/components/ui/button';
import { useConfirm } from '@/app/components/ui/confirm-provider';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import { useToast } from '@/app/components/ui/toast';
import { requestJson } from '@/lib/ui/api-response';
import type { MaintainerApplication } from '@/lib/work-maintainers';
import { notifyInboxChanged } from '@/lib/inbox-events';

export function MaintainerApplicationButton({ workId, initialApplication }: { workId: number; initialApplication: MaintainerApplication }) {
  const t = useMessages();
  const locale = useUiLocale();
  const [application, setApplication] = useState(initialApplication);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const confirm = useConfirm();
  const toast = useToast();
  const endpoint = `/api/works/${workId}/maintainer-requests?${new URLSearchParams({ [UI_LOCALE_PARAM]: locale })}`;
  async function apply() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const preview = await requestJson<{ ok: true; application: MaintainerApplication }>(endpoint, { credentials: 'same-origin' }, t('work.maintainer.readFailed'));
      setApplication(preview.application);
      if (!preview.application.canApply) throw new Error(preview.application.unavailableReason ?? t('work.maintainer.unavailable'));
      await confirm(t('work.maintainer.applyDescription'), {
        title: t('work.maintainer.applyTitle'), confirmLabel: t('work.maintainer.applyConfirm'),
        content: <ul aria-label={t("work.maintainer.recipients")} className="grid min-w-0 grid-cols-1 max-h-60 gap-3 overflow-y-auto">
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
          }, t('work.maintainer.submitFailed'));
          setApplication(result.application);
          notifyInboxChanged();
        },
      });
    } catch (error) { toast.error(error instanceof Error ? error : t('work.maintainer.readFailed')); }
    finally { running.current = false; setBusy(false); }
  }
  if (application.request?.status === 'pending') return <Link to={`/inbox/${application.request.inboxItemId}`}
    className="min-w-0 flex-1 shrink px-1 text-center text-sm font-medium text-secondary hover:underline">{t("work.maintainer.pending")}</Link>;
  return <Button type="button" variant="ghost" className="h-auto min-w-0 flex-1 shrink px-1 py-0 text-sm text-secondary hover:underline"
    disabled={busy} onClick={() => void apply()}>{t("work.maintainer.apply")}</Button>;
}
