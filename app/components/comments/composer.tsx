import { useMessages, useUiLocale } from "@/lib/i18n/react";
import type { MessageKey } from "@/lib/i18n/core";
import { useDocumentNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";
import { useEffect, useRef, useState } from "react";

import { AtSign, ImagePlus, LoaderCircle, Save, Send, X } from "lucide-react";
import { BodyEditor, type BodyEditorHandle } from "./body-editor";
import { CommentComposerToolbar } from "./composer-layout";
import { EmojiPicker } from "@/app/components/emojis/picker";
import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import { createImageProcessor } from "@/app/discussions/image-processor";
import type { DraftImage } from "@/app/discussions/images";
import { COMMENT_IMAGE_BYTES, COMMENT_IMAGE_COUNT, type CommentImage } from "@/lib/comment-images";
import type { CommentTarget } from "@/lib/comment-target";
import type { CommentDto } from "@/lib/dto/db/work-community";

type Attachment = {
  key: string;
  preview: string;
  file?: File;
  processed: boolean;
  stage?: "processing" | "uploading";
  uploaded?: CommentImage;
  error?: string;
};
const NO_IMAGES: DraftImage[] = [];

export function CommentComposer({ endpoint, target, replyToCommentId, inputId = "comment-input", placeholder,
  unavailable = false, onBusyChange, onCreated, editing, onCancel,
}: {
  endpoint: string;
  target: CommentTarget;
  replyToCommentId?: number;
  inputId?: string;
  placeholder?: string;
  unavailable?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onCreated: (comment: CommentDto) => void;
  editing?: CommentDto;
  onCancel?: () => void;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const [body, setBody] = useState(editing?.bodySource ?? "");
  const [images, setImages] = useState<Attachment[]>(() => editing?.images.map((image) => ({
    key: image.id, preview: image.url, processed: true, uploaded: image,
  })) ?? []);
  const [progressMessage, setProgress] = useState<{ id: MessageKey; values?: { index: number; total: number } } | null>(null);
  const progress = progressMessage ? t(progressMessage.id, progressMessage.values) : "";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<BodyEditorHandle>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const processor = useRef<ReturnType<typeof createImageProcessor> | null>(null);
  const resources = useRef(new Set<string>());
  const mounted = useRef(true);
  const pending = useRef(false);
  const requestIdentity = useRef<{ payload: string; key: string } | null>(null);
  const toast = useToast();
  const busy = !!progress;
  const unchangedImages = editing?.images ?? [];
  const dirty = body !== (editing?.bodySource ?? "") ||
    images.length !== unchangedImages.length ||
    images.some((image, index) => image.uploaded?.id !== unchangedImages[index]?.id);
  useDocumentNavigationGuard(dirty || busy);

  useEffect(() => {
    mounted.current = true;
    const urls = resources.current;
    return () => {
      mounted.current = false;
      processor.current?.dispose();
      processor.current = null;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (replyToCommentId) editor.current?.focus();
  }, [replyToCommentId]);

  function start(id: MessageKey) {
    pending.current = true;
    setProgress({ id });
    setError(null);
    onBusyChange?.(true);
  }
  function finish() {
    pending.current = false;
    if (mounted.current) { setProgress(null); setSubmitting(false); onBusyChange?.(false); }
  }
  function release(url: string) {
    if (resources.current.delete(url)) URL.revokeObjectURL(url);
  }
  function updateImage(image: Attachment) {
    if (mounted.current) setImages((current) => current.map((entry) => entry.key === image.key ? { ...image } : entry));
  }
  async function prepareImage(image: Attachment) {
    image.stage = "processing";
    image.error = undefined;
    updateImage(image);
    try {
      if (!image.file) throw new Error(t("image.choose"));
      processor.current ??= createImageProcessor();
      image.file = await processor.current.process(image.file, locale);
      image.processed = true;
    } catch (cause) {
      image.error = cause instanceof Error ? cause.message : t("image.processFailed");
      throw cause;
    } finally {
      image.stage = undefined;
      updateImage(image);
    }
  }
  async function addImages(files: File[]) {
    if (!files.length || pending.current || unavailable) return;
    if (images.length + files.length > COMMENT_IMAGE_COUNT) { setError(t("image.limit")); return; }
    if (files.some((file) => !file.size || file.size > COMMENT_IMAGE_BYTES)) { setError(t("image.size")); return; }
    start("image.processing");
    // Render the original file immediately, before loading codecs or decoding.
    const added: Attachment[] = files.map((file) => {
      const preview = URL.createObjectURL(file);
      resources.current.add(preview);
      return { key: crypto.randomUUID(), preview, file, processed: false, stage: "processing" };
    });
    setImages((current) => [...current, ...added]);
    try {
      for (const image of added) {
        if (!mounted.current) return;
        try { await prepareImage(image); }
        catch {
          if (mounted.current) setError(t("image.retryOrRemove", { error: image.error ?? "" }));
        }
      }
    } finally { finish(); }
  }

  async function submit() {
    if (pending.current || unavailable || !body.trim()) return;
    start("image.uploading");
    const next = images.map((image) => ({ ...image }));
    try {
      for (let index = 0; index < next.length; index++) {
        const image = next[index];
        if (image.uploaded) continue;
        if (!mounted.current) return;
        try {
          if (!image.processed) {
            setProgress({ id: "image.processingIndex", values: { index: index + 1, total: next.length } });
            await prepareImage(image);
          }
          if (!mounted.current) return;
          setProgress({ id: "image.uploadIndex", values: { index: index + 1, total: next.length } });
          image.stage = "uploading";
          image.error = undefined;
          updateImage(image);
          const form = new FormData();
          if (!image.file) throw new Error(t("image.choose"));
          form.set("image", image.file);
          form.set("clientId", image.key);
          form.set("targetKind", target.kind);
          form.set("targetId", String(target.id));
          const result = await requestJson<{ image?: CommentImage }>("/api/comments/images", { method: "POST", credentials: "same-origin", body: form }, t("image.uploadFailed"));
          if (!result.image) throw new Error(t("image.missingResponse"));
          image.uploaded = result.image;
        } catch (cause) {
          image.error = cause instanceof ApiResponseError ? cause.messageFor(locale)
            : cause instanceof Error ? cause.message : t("relation.edit.network");
          throw new Error(image.error);
        } finally { image.stage = undefined; updateImage(image); }
      }
      if (!mounted.current) return;
      setProgress({ id: editing ? "comment.saving" : replyToCommentId ? "comment.postingReply" : "comment.posting" });
      setSubmitting(true);
      const payload = { body, replyToCommentId, imageIds: next.map((image) => image.uploaded!.id) };
      const serialized = JSON.stringify(payload);
      if (requestIdentity.current?.payload !== serialized)
        requestIdentity.current = { payload: serialized, key: crypto.randomUUID() };
      const result = await requestJson<{ comment?: CommentDto }>(endpoint, {
        method: editing ? "PATCH" : "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify(editing ? { body, imageIds: payload.imageIds } : { ...payload, requestKey: requestIdentity.current.key }),
      }, editing ? t("comment.editFailed") : t("comment.postFailed"));
      if (!result.comment) throw new Error(t("comment.missingResponse"));
      if (!mounted.current) return;
      setBody("");
      setImages([]);
      for (const image of next) release(image.preview);
      requestIdentity.current = null;
      // Release the reply target before the parent closes this composer.
      finish();
      onCreated(result.comment);
      toast.success(editing ? t("comment.saved") : replyToCommentId ? t("comment.replyPosted") : t("comment.posted"));
    } catch (cause) {
      if (mounted.current) toast.error(t("comment.draftKept", {
        error: cause instanceof ApiResponseError ? cause.messageFor(locale)
          : cause instanceof Error ? cause.message : t("relation.edit.network"),
      }));
    } finally { finish(); }
  }

  return (
    <div className="grid min-w-0 gap-2" role="group" aria-label={t("comment.editor")}
      onKeyDownCapture={(event) => {
        if (
          (event.target instanceof Element && !!event.target.closest("[data-mention-picker]")) ||
            event.key !== "Enter" || !event.ctrlKey ||
          event.altKey || event.metaKey || event.shiftKey ||
          event.nativeEvent.isComposing || event.keyCode === 229 || composing.current ||
          !(event.target instanceof Node) || !event.currentTarget.contains(event.target)
        ) return;
        // Capture before the body editor handles Ctrl+Enter as a line break.
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) submitButton.current?.click();
      }}
      onPasteCapture={(event) => {
        const files = Array.from(event.clipboardData.files);
        if (files.length) { event.preventDefault(); event.stopPropagation(); void addImages(files); }
      }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDropCapture={(event) => {
        const files = Array.from(event.dataTransfer.files);
        if (files.length) { event.preventDefault(); event.stopPropagation(); void addImages(files); }
      }}
    >
      <BodyEditor ref={editor} textOnly maxLength={2000} inputId={inputId} body={body} images={NO_IMAGES}
        busy={busy || unavailable} topic={false} placeholder={placeholder} autoFocus={!!replyToCommentId || !!editing}
        onChange={setBody} onBusyChange={() => {}} onError={setError}
        onCompositionChange={(value) => { composing.current = value; }} />
      {images.length ? <ul className="flex flex-wrap gap-2" aria-label={t("image.pending")}>
        {images.map((image, index) => <li key={image.key} className="w-24" aria-busy={!!image.stage}>
          <div className="relative aspect-square overflow-hidden rounded-md bg-muted/15">
            <img src={image.preview} alt={t("image.pendingIndex", { index: index + 1 })} className="size-full object-cover" />
            {image.stage ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white" role="status">
                <LoaderCircle aria-hidden className="size-7 animate-spin motion-reduce:animate-none" />
                <span className="sr-only">{t("image.workIndex", { index: index + 1, stage: image.stage ?? "uploading" })}</span>
              </div>
            ) : (
              <Button type="button" size="icon" variant="neutral" className="absolute right-0 top-0" disabled={busy || unavailable}
                aria-label={t("image.removeIndex", { index: index + 1 })} onClick={() => { release(image.preview); setImages((current) => current.filter((item) => item.key !== image.key)); }}><X aria-hidden /></Button>
            )}
          </div>
          {image.error ? <span className="text-xs text-destructive">{t("image.willRetry", { stage: image.processed ? "upload" : "process" })}</span> : null}
        </li>)}
      </ul> : null}
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden disabled={busy || unavailable}
        onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addImages(files); }} />
      <EmojiPicker disabled={busy || unavailable} onSelect={(emoji, options) => editor.current?.insertEmoji(emoji, options)} onClose={() => editor.current?.focus()}>
        {(trigger) => <CommentComposerToolbar tools={<>{trigger}<Button type="button" variant="ghost" size="icon" aria-label={t("mention.label")} title={t("mention.label")} data-mention-trigger={inputId} disabled={busy || unavailable} onClick={() => editor.current?.mention()}><AtSign aria-hidden /></Button><Button type="button" variant="ghost" size="icon" aria-label={t("image.upload")} title={t("image.upload")} disabled={busy || unavailable || images.length >= COMMENT_IMAGE_COUNT}
            onClick={() => picker.current?.click()}><ImagePlus aria-hidden /></Button></>} actions={<>
            {editing ? <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>{t("relation.edit.cancel")}</Button> : null}
            <Button ref={submitButton} type="button" disabled={busy || unavailable || !body.trim()} onClick={() => void submit()}
              title={t("comment.submitShortcut")} aria-keyshortcuts="Control+Enter">{editing ? <Save aria-hidden /> : <Send aria-hidden />}{submitting ? progress : editing ? t("comment.saveEdit") : replyToCommentId ? t("comment.postReply") : t("comment.post")}</Button>
        </>} />}
      </EmojiPicker>
      {progress ? <p role="status" className="sr-only">{progress}</p> : null}
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
