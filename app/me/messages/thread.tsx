import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { FaceEmojiView } from "@/app/components/emojis/face-emoji";
import { Button } from "@/app/components/ui/button";
import { Timestamp } from "@/app/components/ui/timestamp";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { useToast } from "@/app/components/ui/toast";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { AUTO_LINK_PATTERN, autoLink } from "@/lib/auto-links";
import type { DirectMessagePage } from "@/lib/dto/db/messages";
import { FACE_EMOJI_PATTERN, type FaceEmoji } from "@/lib/face-emojis";
import { MESSAGE_PAGE_SIZE } from "@/lib/messages";
import { notifyInboxChanged } from "@/lib/inbox-events";
import { requestJson } from "@/lib/ui/api-response";
import { MessageComposer } from "./composer";
import { useMessageRoom } from "./use-message-room";

export function MessageThread({ viewerId, initial }: { viewerId: number; initial: DirectMessagePage }) {
  const [page, setPage] = useState(initial);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const current = useRef(initial);
  const list = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const prependHeight = useRef<number | null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const readThrough = useRef(0);
  const alive = useRef(true);
  const toast = useToast();
  const peerId = initial.peer.id;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const merge = useCallback((next: DirectMessagePage, older = false) => {
    if (!alive.current) return;
    const previous = current.current;
    const messages = new Map([...previous.messages, ...next.messages].map(message => [message.id, message]));
    const emojis = new Map([...previous.emojis, ...next.emojis].map(emoji => [emoji.id, emoji]));
    current.current = { peer: next.peer, messages: [...messages.values()].sort((a, b) => a.id - b.id),
      emojis: [...emojis.values()], hasOlder: older ? next.hasOlder : previous.hasOlder };
    setPage(current.current);
  }, []);

  const refresh = useCallback((): Promise<void> => {
    again.current = true;
    if (loading.current) return loading.current;
    const task = (async () => {
      while (again.current && alive.current) {
        again.current = false;
        let more = true;
        while (more && alive.current) {
          const after = current.current.messages.at(-1)?.id ?? 0;
          const next = await requestJson<DirectMessagePage>(`/api/messages/${peerId}?after=${after}`, { cache: "no-store" });
          merge(next);
          more = next.messages.length === MESSAGE_PAGE_SIZE;
        }
      }
      if (alive.current) notifyInboxChanged();
    })();
    loading.current = task;
    void task.finally(() => { loading.current = null; }).catch(() => {});
    return task;
  }, [peerId, merge]);
  useMessageRoom(peerId, refresh);

  useEffect(() => { merge(initial); }, [initial, merge]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    if (prependHeight.current !== null) {
      element.scrollTop += element.scrollHeight - prependHeight.current;
      prependHeight.current = null;
    } else if (followBottom.current) element.scrollTop = element.scrollHeight;
  }, [page.messages]);

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const visible = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let inFlight = false;
    async function markRead() {
      if (disposed || inFlight || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const through = Math.max(0, ...visible);
      if (through <= readThrough.current) return;
      inFlight = true;
      try {
        await requestJson(`/api/messages/${peerId}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ through }) });
        readThrough.current = Math.max(readThrough.current, through);
        notifyInboxChanged();
      } catch { /* Viewing the conversation again retries the read marker. */ }
      finally { inFlight = false; }
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void markRead(), 600); };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = Number((entry.target as HTMLElement).dataset.messageId);
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) visible.add(id); else visible.delete(id);
      }
      schedule();
    }, { root: element, threshold: 0.5 });
    for (const marker of element.querySelectorAll<HTMLElement>("[data-message-id]")) observer.observe(marker);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => { disposed = true; observer.disconnect(); clearTimeout(timer); window.removeEventListener("focus", schedule); document.removeEventListener("visibilitychange", schedule); };
  }, [page.messages, peerId]);

  async function older() {
    if (loadingOlder || !page.messages.length) return;
    setLoadingOlder(true);
    try {
      const next = await requestJson<DirectMessagePage>(`/api/messages/${peerId}?before=${page.messages[0].id}`, { cache: "no-store" });
      followBottom.current = false;
      prependHeight.current = list.current?.scrollHeight ?? null;
      merge(next, true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "读取失败"); }
    finally { setLoadingOlder(false); }
  }

  return <>
    <AccountPageHeader title="短信箱" actions={<Button asChild variant="ghost" size="sm"><Link to="/me/messages"><ArrowLeft aria-hidden />返回</Link></Button>} />
    <section className="mt-4 flex h-[min(72dvh,48rem)] min-h-80 flex-col overflow-hidden rounded-lg border border-border bg-card" aria-label={`与${page.peer.displayName}的短信`}>
      <Link className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 text-sm font-semibold" to={`/users/${peerId}`}>
        <UserAvatar avatarBlobSha256={page.peer.avatarBlobSha256} displayName={page.peer.displayName} size={32} />{page.peer.displayName}
      </Link>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" role="log" aria-label="短信记录" aria-live="polite" aria-relevant="additions"
        onScroll={event => { const element = event.currentTarget; followBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96; }}>
        {page.hasOlder ? <div className="mb-4 text-center"><Button type="button" variant="ghost" size="sm" disabled={loadingOlder} onClick={() => void older()}>更早的短信</Button></div> : null}
        <div className="flex flex-col gap-4">
          {page.messages.map(message => <div key={message.id}
            className={message.senderUserId === viewerId ? "flex flex-col items-end" : "flex flex-col items-start"}>
            <div className={message.image ? "max-w-[85%]" : message.senderUserId === viewerId ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2" : "max-w-[85%] rounded-2xl rounded-bl-sm bg-muted/15 px-3 py-2"}>
              {message.image ? <a className="block" href={message.image.url} target="_blank" rel="noreferrer" aria-label="查看图片">
                <img src={message.image.url} width={message.image.width} height={message.image.height} alt="图片短信" loading="lazy" className="block h-auto max-h-72 w-auto max-w-full rounded-md object-contain"
                  onLoad={() => { const element = list.current; if (element && followBottom.current) element.scrollTop = element.scrollHeight; }} />
              </a> : <p className="m-0 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed"><MessageText body={message.body} emojis={page.emojis} /></p>}
            </div>
            <span className="mt-1 inline-flex" data-message-id={message.senderUserId !== viewerId ? message.id : undefined}>
              <Timestamp className="text-muted" value={message.createdAt} />
            </span>
          </div>)}
        </div>
      </div>
      {page.peer.canSend ? <MessageComposer peerId={peerId} lastMessageId={page.messages.at(-1)?.id ?? 0} onSent={async () => { followBottom.current = true; await refresh(); if (list.current) list.current.scrollTop = list.current.scrollHeight; }} /> : null}
    </section>
  </>;
}

function MessageText({ body, emojis }: { body: string; emojis: FaceEmoji[] }) {
  const parts: ReactNode[] = [];
  const pattern = new RegExp(`${FACE_EMOJI_PATTERN.source}|${AUTO_LINK_PATTERN.source}`, "g");
  let cursor = 0;
  for (const match of body.matchAll(pattern)) {
    parts.push(body.slice(cursor, match.index));
    if (match[1]) parts.push(<FaceEmojiView key={match.index} emoji={emojis.find(emoji => emoji.id === Number(match[1])) ?? null} />);
    else {
      const link = autoLink(match[0]);
      parts.push(link ? <span key={match.index}><a href={link.href} target="_blank" rel="noreferrer" className="text-primary underline">{link.text}</a>{link.suffix}</span> : match[0]);
    }
    cursor = match.index + match[0].length;
  }
  parts.push(body.slice(cursor));
  return <>{parts}</>;
}
