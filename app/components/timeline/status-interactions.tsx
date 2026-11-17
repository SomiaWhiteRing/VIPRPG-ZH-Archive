import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM, type UiLocale } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePushReply } from "@/app/components/use-push-reply";
import { useIsPostAuthorHidden } from "@/app/components/use-is-post-author-hidden";
import { useRevalidator } from "react-router";
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

async function request(path: string, locale: UiLocale, method = "GET", body?: unknown) {

  const url = new URL(path, window.location.origin);
  url.searchParams.set(UI_LOCALE_PARAM, locale);
  const result = await requestJson(url.href, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) }, translate(locale, "timeline.action.failed")) as TimelineReplyPage & { detail?: string; error?: string };

  return result;
}

export function StatusInteractions({ item, viewerId, readOnly = false, expandReplies = true, hideStatus = false, initialPage, onCacheError, onBusyChange, children }: {
  item: TimelineItem; viewerId: number | null; onCacheError: () => void; onBusyChange: (value: boolean) => void;
  readOnly?: boolean;
  expandReplies?: boolean;
  hideStatus?: boolean;
  initialPage?: TimelineReplyPage;
  children?: ReactNode;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const isPostAuthorHidden = useIsPostAuthorHidden();
  const [open, setOpen] = useState(!!initialPage);
  const [page, setPage] = useState<TimelineReplyPage | null>(initialPage ?? null);
  const [addressed, setAddressed] = useState(!!initialPage);
  const [actionBusy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const busy = actionBusy || imageBusy;
  const replyEditor = useRef<StatusEditorHandle>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const pending = useRef(false), composing = useRef(false);
  const draft = useTimelineDraft({ userId: readOnly || hideStatus ? null : viewerId, kind: "reply", eventId: item.id, onError: onCacheError });
  const confirm = useConfirm(), toast = useToast(), revalidator = useRevalidator();
  const regionId = `timeline-replies-${item.id}`, editorId = `timeline-reply-${item.id}`;
  const pushReply = usePushReply();
  const handledPushReply = useRef<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusyChange(true); setError("");
    try { await action(); }
    catch (error) { setError(error instanceof ApiResponseError ? error.messageFor(locale) : error instanceof Error ? error.message : t("timeline.action.failed")); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }, [locale, onBusyChange, t]);
  const load = useCallback(async (cursor?: number | null) => {
    const result = await request(`/api/timeline/${item.id}/replies${cursor ? `?cursor=${cursor}` : ""}`, locale) as TimelineReplyPage;
    setPage((current) => ({ ...result, items: cursor && current ? [...current.items, ...result.items.filter((reply) => !current.items.some((old) => old.id === reply.id))] : result.items }));
    if (!cursor) setAddressed(false);
  }, [item.id, locale]);
  useEffect(() => {
    if (pushReply.value !== String(item.id) || handledPushReply.current === pushReply.key || readOnly || hideStatus || !item.canReply || !expandReplies || !draft.ready || busy) return;
    handledPushReply.current = pushReply.key;
    setOpen(true);
    const loaded = page ? Promise.resolve() : run(() => load());
    void loaded.then(() => requestAnimationFrame(() => document.getElementById(editorId)?.focus()));
  }, [pushReply.value, pushReply.key, item.id, item.canReply, readOnly, hideStatus, expandReplies, page, run, load, editorId, draft.ready, busy]);

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
    if (!body || bodyLength(body) > 500) { setError(t("timeline.action.replyLength")); return; }
    await run(async () => {
      const imageIds = await replyEditor.current!.uploadImages();
      setPublishing(true);
      try {
        await request(`/api/timeline/${item.id}/replies`, locale, "POST", { body, imageIds, requestKey: draft.requestKey });
        await draft.clear();
        toast.success(t("timeline.action.replySaved"));
        await load();
        await revalidator.revalidate();
      } finally { setPublishing(false); }
    });
  }
  async function remove(replyId: number) {
    if (busy || !await confirm(t("timeline.action.replyConfirm"), { title: t("timeline.action.deleteReply"), confirmLabel: t("timeline.action.delete"), destructive: true })) return;
    await run(async () => {
      await request(`/api/timeline/replies/${replyId}`, locale, "DELETE");
      await load(); await revalidator.revalidate();
    });
  }

  return <div className="mt-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {!hideStatus && (readOnly ? item.likeCount > 0 && <span className="inline-flex min-h-8 items-center gap-1.5 px-1"><ThumbsUp aria-hidden className="size-4" />{t("timeline.action.like")} {item.likeCount}</span> : <Button variant="ghost" size="sm" className="min-h-8 gap-1.5 px-1 text-xs font-normal text-muted" type="button" disabled={busy || !item.canLike} aria-pressed={item.likedByMe}
        aria-label={item.likedByMe ? t("timeline.action.unlike") : t("timeline.action.like")} onClick={() => void run(async () => {
          await request(`/api/timeline/${item.id}/like`, locale, item.likedByMe ? "DELETE" : "PUT"); await revalidator.revalidate();
        })}><ThumbsUp aria-hidden className={item.likedByMe ? "fill-current text-primary" : undefined} />{t("timeline.action.like")}{item.likeCount > 0 ? ` ${item.likeCount}` : ""}</Button>)}
      {expandReplies ? <Button variant="ghost" size="sm" className="min-h-8 gap-1.5 px-1 text-xs font-normal text-muted" type="button" disabled={busy} aria-expanded={open} aria-controls={regionId} onClick={toggle}>
        <MessageSquare aria-hidden />{t("timeline.action.reply")}{item.replyCount > 0 ? ` ${item.replyCount}` : ""}
      </Button> : item.replyCount > 0 && <span className="inline-flex min-h-8 items-center gap-1.5 px-1"><MessageSquare aria-hidden className="size-4" />{t("timeline.action.reply")} {item.replyCount}</span>}
      {children}
    </div>
    {expandReplies && open && <section id={regionId} aria-label={t("timeline.action.replies")} aria-busy={busy} className={nestedRepliesClassName}>
      {addressed && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => void run(() => load())}>{t("timeline.action.allReplies")}</Button>}
      {error && <Notice role="alert" className="mb-3">{error}<Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => void run(() => load())}>{t("timeline.action.reloadReplies")}</Button></Notice>}
      {!page && busy && <p className="m-0 text-sm text-muted">{t("timeline.action.loadingReplies")}</p>}
      {page?.items.filter(reply => !isPostAuthorHidden(reply.actor.id)).map((reply) => <NestedReply key={reply.id} id={`timeline-reply-item-${reply.id}`}
        metadata={<><Link className="font-medium text-primary" to={`/users/${reply.actor.id}`}>{reply.actor.displayName}</Link><Timestamp value={reply.createdAt} format="duration" /></>}
        actions={!readOnly && reply.canDelete && <Button variant="ghost" size="sm" type="button" disabled={busy} aria-label={t("timeline.action.deleteReply")} onClick={() => void remove(reply.id)}><Trash2 aria-hidden />{t("timeline.action.delete")}</Button>}>
        <StatusBody segments={reply.body} />
        <CommentImages images={reply.images} imageLabel={t("timeline.action.replyImage")} />
      </NestedReply>)}
      {page && !page.items.length && <p className="m-0 mb-3 text-sm text-muted">{t("timeline.action.emptyReplies")}</p>}
      {page?.nextCursor && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => void run(() => load(page.nextCursor))}>{t("timeline.action.moreReplies")}</Button>}
      {!readOnly && !hideStatus && item.canReply && <CommentReplyLayout inputId={editorId} displayName={item.actor.displayName} busy={busy} onCancel={() => setOpen(false)}>
        <form className="grid min-w-0 gap-2" onSubmit={(event) => void submit(event)} onKeyDownCapture={(event) => {
          if (event.key !== "Enter" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
            event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) submitButton.current?.click();
        }}>
          <StatusEditor ref={replyEditor} id={editorId} label={t("timeline.action.replyBody")} body={draft.body} images={draft.images} onImagesChange={draft.setImages} onImagesBusyChange={setImageBusy} eventId={item.id} busy={busy || !draft.ready} onChange={draft.setBody} onError={setError} onCompositionChange={(value) => { composing.current = value; }} actions={
            <Button ref={submitButton} type="submit" disabled={busy || !draft.ready || !draft.body.trim()} title={t("timeline.action.shortcut")} aria-keyshortcuts="Control+Enter"><Send aria-hidden />{publishing ? t("timeline.action.replySending") : t("timeline.action.replySubmit")}</Button>
          } />
        </form>
      </CommentReplyLayout>}
    </section>}
    {!open && error && <Notice role="alert" className="mt-2">{error}</Notice>}
  </div>;
}
