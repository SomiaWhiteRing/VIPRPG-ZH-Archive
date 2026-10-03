import { requestJson } from "@/lib/ui/api-response";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as Popover from "@/app/components/ui/popover";
import { X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { MentionSearchUser, MentionUser } from "@/lib/mentions";

export function MentionPicker({ container, anchor, inputId, onSelect, onClose }: {
  container: HTMLElement | null;
  anchor: HTMLElement | null;
  inputId: string;
  onSelect: (user: MentionUser) => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [users, setUsers] = useState<MentionSearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const results = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (!query.trim() || composing) return () => controller.abort();
    const timer = setTimeout(() => {
      void requestJson<{ users?: MentionSearchUser[] }>(`/api/users/mentions?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, credentials: "same-origin" }, "用户搜索失败")
        .then((result) => {
          if (!result.users) throw new Error("服务器未返回用户搜索结果。");
          if (!controller.signal.aborted) setUsers(result.users);
        }).catch((cause) => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "用户搜索失败。");
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, composing, retry]);
  return <Popover.Root open modal={false} onOpenChange={(open) => { if (!open) onClose(false); }}>
    <Popover.Anchor virtualRef={{ current: anchor }} />
    <Popover.Portal anchorRef={anchorRef} container={container}>
      <Popover.Content aria-label="提及用户" data-mention-picker
        side="bottom" align="start" sideOffset={6} collisionPadding={12}
        onOpenAutoFocus={(event) => { event.preventDefault(); search.current?.focus(); }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); onClose(true); }}
        onInteractOutside={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest<HTMLElement>("[data-mention-trigger]")?.dataset.mentionTrigger === inputId)
            event.preventDefault();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className="z-[70] flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-card p-2 text-card-foreground shadow-surface">
        <div className="flex shrink-0 items-center gap-1">
        <Label htmlFor={id} className="sr-only">搜索昵称或用户 UID</Label>
        <Input ref={search} id={id} value={query} maxLength={80} autoComplete="off" placeholder="搜索昵称或用户 UID"
          onChange={(event) => { setQuery(event.target.value); setUsers([]); setError(""); setLoading(!!event.target.value.trim()); }}
          onCompositionStart={() => { setComposing(true); setUsers([]); }}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229 || composing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const buttons = results.current?.querySelectorAll<HTMLButtonElement>("button");
              buttons?.[event.key === "ArrowDown" ? 0 : buttons.length - 1]?.focus();
            }
            if (event.key === "Enter") { event.preventDefault(); if (users[0] && !loading) onSelect(users[0]); }
          }} />
        <Button type="button" size="icon" variant="ghost" className="shrink-0" aria-label="收起用户搜索" title="收起用户搜索" onClick={() => onClose(true)}><X aria-hidden /></Button>
        </div>
        <div role="status" className="mt-2 text-sm text-muted">
          {error || (!query.trim() ? "" : loading || composing ? "正在搜索…" : !users.length ? "没有找到用户。" : "")}
        </div>
        {error ? <Button type="button" variant="ghost" onClick={() => { setError(""); setLoading(true); setRetry((value) => value + 1); }}>重试</Button> : null}
        <ul ref={results} className="mt-2 min-h-0 overflow-y-auto" aria-label="用户搜索结果">
          {users.map((user) => <li key={user.id}><Button type="button" variant="ghost" className="h-auto w-full justify-between whitespace-normal py-3 text-left"
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const buttons = Array.from(results.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
              const next = buttons.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1);
              (buttons[next] ?? search.current)?.focus();
            }}
            onClick={() => onSelect(user)}><span className="min-w-0 break-words">@{user.displayName}</span><UserAvatar displayName={user.displayName} avatarBlobSha256={user.avatarBlobSha256} size={28} className="size-7 shrink-0" /></Button></li>)}
        </ul>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
