import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/app/components/ui/button';
import { useConfirm } from '@/app/components/ui/confirm-provider';
import { Pane } from '@/app/components/ui/pane';
import { SearchComboBox } from '@/app/components/ui/search-combobox';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import { useToast } from '@/app/components/ui/toast';
import { requestJson } from '@/lib/ui/api-response';
import { MAINTAINER_GRANT_DESCRIPTION, type MaintainerUser } from '@/lib/work-maintainers';
import { notifyInboxChanged } from '@/lib/inbox-events';

export function WorkMaintainerEditor({ workId, initialMaintainers, canRemove = false }: {
  workId: number; initialMaintainers: MaintainerUser[]; canRemove?: boolean;
}) {
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
  const endpoint = `/api/works/${workId}/maintainers`;
  useEffect(() => {
    if (!query.trim() || selected) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void requestJson<{ ok: true; users: MaintainerUser[] }>(`${endpoint}?q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal }, '用户搜索失败')
        .then((result) => { if (!controller.signal.aborted) setUsers(result.users); })
        .catch((error) => { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : '用户搜索失败。'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [endpoint, query, selected]);

  async function change(person: MaintainerUser, action: 'add' | 'remove') {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await confirm(action === 'add' ? `确定将“${person.displayName}”加入作品维护者？\n\n${MAINTAINER_GRANT_DESCRIPTION}`
        : `确定移除“${person.displayName}”？移除后，该用户将失去这部作品的维护资格，不能再通过“我的上传”维护本作；独立的全站权限不受影响。`, {
        title: action === 'add' ? '添加作品维护者？' : '移除作品维护者？',
        confirmLabel: action === 'add' ? '确认添加' : '确认移除', destructive: action === 'remove',
        action: async () => {
          const result = await requestJson<{ ok: true; users: MaintainerUser[] }>(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, userId: person.id, confirm: true }),
          }, '调整维护者失败');
          setMaintainers(result.users);
          setSelected(null); setQuery(''); setUsers([]); setLoading(false);
          notifyInboxChanged();
        },
      });
    } catch (error) { toast.error(error instanceof Error ? error.message : '调整维护者失败。'); }
    finally { running.current = false; setBusy(false); }
  }
  return <div className="my-8"><Pane heading="作品维护者">
    <ul className="grid min-w-0 grid-cols-1 gap-3">
      {maintainers.map((person) => <li key={person.id} className="flex min-w-0 items-center justify-between gap-3">
        <Link className="flex min-w-0 items-center gap-2 text-sm hover:underline" to={`/users/${person.id}`}>
          <UserAvatar displayName={person.displayName} avatarBlobSha256={person.avatarBlobSha256} size={32} className="size-8 shrink-0" />
          <span className="min-w-0 wrap-anywhere">{person.displayName}</span>
        </Link>
        {canRemove ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void change(person, 'remove')}>移除</Button> : null}
      </li>)}
    </ul>
    <div className="mt-4 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <SearchComboBox id={inputId} label="添加作品维护者" placeholder="搜索昵称或用户 UID" maxLength={80}
        query={query} items={users} loading={loading} disabled={busy} selectedKey={selected?.id ?? null}
        getKey={(person) => person.id} getText={(person) => person.displayName}
        renderItem={(person) => <span className="flex min-w-0 items-center gap-2">
          <UserAvatar displayName={person.displayName} avatarBlobSha256={person.avatarBlobSha256} size={28} className="size-7 shrink-0" />
          <span className="min-w-0 wrap-anywhere">{person.displayName}</span>
        </span>}
        onQueryChange={(value) => { setQuery(value); setSelected(null); setUsers([]); setSearchError(''); setLoading(!!value.trim()); }}
        onChoose={(person) => { setSelected(person); setQuery(person.displayName); setLoading(false); }}
        onClear={() => { setSelected(null); setQuery(''); setUsers([]); setLoading(false); setSearchError(''); }}
        emptyState={searchError || (query.trim() ? '没有找到可添加的用户。' : '输入昵称或用户 UID 搜索。')} />
      <Button type="button" disabled={busy || !selected} onClick={() => { if (selected) void change(selected, 'add'); }}>添加维护者</Button>
    </div>
  </Pane></div>;
}
