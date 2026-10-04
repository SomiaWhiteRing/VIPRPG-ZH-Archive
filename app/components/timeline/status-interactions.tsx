import { requestJson } from "@/lib/ui/api-response";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useRevalidator } from "react-router";
import { MessageSquare, Send, ThumbsUp, Trash2 } from "lucide-react";
import { NestedReply, nestedRepliesClassName } from "@/app/components/comments/nested-reply";
import { CommentReplyLayout } from "@/app/components/comments/composer-layout";
import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { Timestamp } from "@/app/components/ui/timestamp";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { useToast } from "@/app/components/ui/toast";
import { StatusBody, StatusEditor, type StatusEditorHandle } from "./status-editor";
import { CommentImages } from "@/app/components/comments/images";
import { useTimelineDraft } from "./draft-cache";
import { bodyLength } from "@/lib/face-emojis";
import type { TimelineItem, TimelineReplyPage } from "@/lib/dto/db/timeline";

async function request(path: string, method = "GET", body?: unknown) {

  const result = await requestJson(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) }) as TimelineReplyPage & { detail?: string; error?: string };

  return result;
}

export function StatusInteractions({ item, viewerId, readOnly = false, expandReplies = true, onCacheError, onBusyChange, children }: {
  item: TimelineItem; viewerId: number | null; onCacheError: () => void; onBusyChange: (value: boolean) => void;
  readOnly?: boolean;
  expandReplies?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<TimelineReplyPage | null>(null);
  const [actionBusy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const busy = actionBusy || imageBusy;
  const replyEditor = useRef<StatusEditorHandle>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const pending = useRef(false), composing = useRef(false);
  const draft = useTimelineDraft({ userId: readOnly ? null : viewerId, kind: "reply", eventId: item.id, onError: onCacheError });
  const confirm = useConfirm(), toast = useToast(), revalidator = useRevalidator();
  const regionId = `timeline-replies-${item.id}`, editorId = `timeline-reply-${item.id}`;

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusyChange(true); setError("");
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "操作失败，请重试。"); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }
  async function load(cursor?: number | null) {
    const result = await request(`/api/timeline/${item.id}/replies${cursor ? `?cursor=${cursor}` : ""}`) as TimelineReplyPage;
    setPage((current) => ({ ...result, items: cursor && current ? [...current.items, ...result.items.filter((reply) => !current.items.some((old) => old.id === reply.id))] : result.items }));
  }
  function toggle() {
    if (busy || !expandReplies) return;
    if (open) { setOpen(false); return; }
    setOpen(true);
    setPage(null);
    void run(() => load());
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing.current || imageBusy || !draft.ready) return;
    const body = draft.body.trim();
    if (!body || bodyLength(body) > 500) { setError("请填写 1–500 个字符的回复。"); return; }
    await run(async () => {
      const imageIds = await replyEditor.current!.uploadImages();
      setPublishing(true);
      try {
        await request(`/api/timeline/${item.id}/replies`, "POST", { body, imageIds, requestKey: draft.requestKey });
        await draft.clear();
        toast.success("回复已发布。");
        await load();
        await revalidator.revalidate();
      } finally { setPublishing(false); }
    });
  }
  async function remove(replyId: number) {
    if (busy || !await confirm("确定删除这条回复？", { title: "删除回复", confirmLabel: "删除", destructive: true })) return;
    await run(async () => {
      await request(`/api/timeline/replies/${replyId}`, "DELETE");
      await load(); await revalidator.revalidate();
    });
  }

  return <div className="mt-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {readOnly ? item.likeCount > 0 && <span className="inline-flex min-h-8 items-center gap-1.5 px-1"><ThumbsUp aria-hidden className="size-4" />点赞 {item.likeCount}</span> : <Button variant="ghost" size="sm" className="min-h-8 gap-1.5 px-1 text-xs font-normal text-muted" type="button" disabled={busy || !item.canLike} aria-pressed={item.likedByMe}
        aria-label={item.likedByMe ? "取消点赞" : "点赞"} onClick={() => void run(async () => {
          await request(`/api/timeline/${item.id}/like`, item.likedByMe ? "DELETE" : "PUT"); await revalidator.revalidate();
        })}><ThumbsUp aria-hidden className={item.likedByMe ? "fill-current text-primary" : undefined} />点赞{item.likeCount > 0 ? ` ${item.likeCount}` : ""}</Button>}
      {expandReplies ? <Button variant="ghost" size="sm" className="min-h-8 gap-1.5 px-1 text-xs font-normal text-muted" type="button" disabled={busy} aria-expanded={open} aria-controls={regionId} onClick={toggle}>
        <MessageSquare aria-hidden />回复{item.replyCount > 0 ? ` ${item.replyCount}` : ""}
      </Button> : item.replyCount > 0 && <span className="inline-flex min-h-8 items-center gap-1.5 px-1"><MessageSquare aria-hidden className="size-4" />回复 {item.replyCount}</span>}
      {children}
    </div>
    {expandReplies && open && <section id={regionId} aria-label="吐槽回复" aria-busy={busy} className={nestedRepliesClassName}>
      {error && <Notice role="alert" className="mb-3">{error}<Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => void run(() => load())}>重新加载回复</Button></Notice>}
      {!page && busy && <p className="m-0 text-sm text-muted">加载回复中……</p>}
      {page?.items.map((reply) => <NestedReply key={reply.id} id={`timeline-reply-item-${reply.id}`}
        metadata={<><Link className="font-medium text-primary" to={`/users/${reply.actor.id}`}>{reply.actor.displayName}</Link><Timestamp value={reply.createdAt} /></>}
        actions={!readOnly && reply.canDelete && <Button variant="ghost" size="sm" type="button" disabled={busy} aria-label="删除回复" onClick={() => void remove(reply.id)}><Trash2 aria-hidden />删除</Button>}>
        <StatusBody segments={reply.body} />
        <CommentImages images={reply.images} imageLabel="回复图片" />
      </NestedReply>)}
      {page && !page.items.length && <p className="m-0 mb-3 text-sm text-muted">还没有回复。</p>}
      {page?.nextCursor && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => void run(() => load(page.nextCursor))}>更多回复</Button>}
      {!readOnly && item.canReply && <CommentReplyLayout inputId={editorId} displayName={item.actor.displayName} busy={busy} onCancel={() => setOpen(false)}>
        <form className="grid min-w-0 gap-2" onSubmit={(event) => void submit(event)} onKeyDownCapture={(event) => {
          if (event.key !== "Enter" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
            event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) submitButton.current?.click();
        }}>
          <StatusEditor ref={replyEditor} id={editorId} label="回复内容" body={draft.body} images={draft.images} onImagesChange={draft.setImages} onImagesBusyChange={setImageBusy} eventId={item.id} busy={busy || !draft.ready} onChange={draft.setBody} onError={setError} onCompositionChange={(value) => { composing.current = value; }} actions={
            <Button ref={submitButton} type="submit" disabled={busy || !draft.ready || !draft.body.trim()} title="Ctrl+Enter 提交" aria-keyshortcuts="Control+Enter"><Send aria-hidden />{publishing ? "正在发布回复…" : "发布回复"}</Button>
          } />
        </form>
      </CommentReplyLayout>}
    </section>}
    {!open && error && <Notice role="alert" className="mt-2">{error}</Notice>}
  </div>;
}
