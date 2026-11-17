import { useEffect, useId, useRef, useState } from 'react';
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { formatFeedbackError } from "@/lib/i18n/feedback";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { Button } from '@/app/components/ui/button';
import { useConfirm } from '@/app/components/ui/confirm-provider';
import { Pane } from '@/app/components/ui/pane';
import { SearchComboBox } from '@/app/components/ui/search-combobox';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import { useToast } from '@/app/components/ui/toast';
import { requestJson } from '@/lib/ui/api-response';
import type { MaintainerUser } from '@/lib/work-maintainers';
import { notifyInboxChanged } from '@/lib/inbox-events';

export function WorkMaintainerEditor({ workId, initialMaintainers, canRemove = false }: {
  workId: number; initialMaintainers: MaintainerUser[]; canRemove?: boolean;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const [maintainers, setMaintainers] = useState(initialMaintainers);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<MaintainerUser[]>([]);
  const [selected, setSelected] = useState<MaintainerUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const confirm = useConfirm();
  const toast = useToast();
  const inputId = useId();
  const endpoint = `/api/works/${workId}/maintainers?${new URLSearchParams({ [UI_LOCALE_PARAM]: locale })}`;
  useEffect(() => {
    if (!query.trim() || selected) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void requestJson<{ ok: true; users: MaintainerUser[] }>(`${endpoint}&q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal }, t('work.maintainer.searchFailed'))
        .then((result) => { if (!controller.signal.aborted) setUsers(result.users); })
        .catch((error) => { if (!controller.signal.aborted) setSearchError(formatFeedbackError(error, locale, t('work.maintainer.searchFailed'))); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [endpoint, locale, query, selected, t]);

  async function change(person: MaintainerUser, action: 'add' | 'remove') {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await confirm(t(action === 'add' ? 'work.maintainer.addDescription' : 'work.maintainer.removeDescription', { name: person.displayName }), {
        title: action === 'add' ? t('work.maintainer.addTitle') : t('work.maintainer.removeTitle'),
        confirmLabel: action === 'add' ? t('work.maintainer.addConfirm') : t('work.maintainer.removeConfirm'), destructive: action === 'remove',
        action: async () => {
          const result = await requestJson<{ ok: true; users: MaintainerUser[] }>(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, userId: person.id, confirm: true }),
          }, t('work.maintainer.changeFailed'));
          setMaintainers(result.users);
          setSelected(null); setQuery(''); setUsers([]); setLoading(false);
          notifyInboxChanged();
        },
      });
    } catch (error) { toast.error(error instanceof Error ? error : t('work.maintainer.changeFailed')); }
    finally { running.current = false; setBusy(false); }
  }
  return <div className="my-8"><Pane heading={t("work.maintainer.heading")}>
    <ul className="grid min-w-0 grid-cols-1 gap-3">
      {maintainers.map((person) => <li key={person.id} className="flex min-w-0 items-center justify-between gap-3">
        <Link className="flex min-w-0 items-center gap-2 text-sm hover:underline" to={`/users/${person.id}`}>
          <UserAvatar displayName={person.displayName} avatarBlobSha256={person.avatarBlobSha256} size={32} className="size-8 shrink-0" />
          <span className="min-w-0 wrap-anywhere">{person.displayName}</span>
        </Link>
        {canRemove ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void change(person, 'remove')}>{t("work.maintainer.remove")}</Button> : null}
      </li>)}
    </ul>
    <div className="mt-4 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <SearchComboBox id={inputId} label={t("work.maintainer.addLabel")} placeholder={t("work.maintainer.search")} maxLength={80}
        query={query} items={users} loading={loading} disabled={busy} selectedKey={selected?.id ?? null}
        getKey={(person) => person.id} getText={(person) => person.displayName}
        renderItem={(person) => <span className="flex min-w-0 items-center gap-2">
          <UserAvatar displayName={person.displayName} avatarBlobSha256={person.avatarBlobSha256} size={28} className="size-7 shrink-0" />
          <span className="min-w-0 wrap-anywhere">{person.displayName}</span>
        </span>}
        onQueryChange={(value) => { setQuery(value); setSelected(null); setUsers([]); setSearchError(''); setLoading(!!value.trim()); }}
        onChoose={(person) => { setSelected(person); setQuery(person.displayName); setLoading(false); }}
        onClear={() => { setSelected(null); setQuery(''); setUsers([]); setLoading(false); setSearchError(''); }}
        emptyState={searchError || (query.trim() ? t('work.maintainer.noUser') : t('work.maintainer.searchHint'))} />
      <Button type="button" disabled={busy || !selected} onClick={() => { if (selected) void change(selected, 'add'); }}>{t("work.maintainer.add")}</Button>
    </div>
  </Pane></div>;
}
