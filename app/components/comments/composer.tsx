import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Send, X } from "lucide-react";
import { BodyEditor, type BodyEditorHandle } from "./body-editor";
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
  file: File;
  processed: boolean;
  stage?: "processing" | "uploading";
  uploaded?: CommentImage;
  error?: string;
};
const NO_IMAGES: DraftImage[] = [];

export function CommentComposer({ endpoint, target, replyToCommentId, inputId = "comment-input", placeholder,
  unavailable = false, onBusyChange, onCreated,
}: {
  endpoint: string;
  target: CommentTarget;
  replyToCommentId?: number;
  inputId?: string;
  placeholder?: string;
  unavailable?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onCreated: (comment: CommentDto) => void;
}) {
  const [body, setBody] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const [progress, setProgress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<BodyEditorHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const processor = useRef<ReturnType<typeof createImageProcessor> | null>(null);
  const resources = useRef(new Set<string>());
  const mounted = useRef(true);
  const pending = useRef(false);
  const requestIdentity = useRef<{ payload: string; key: string } | null>(null);
  const toast = useToast();
  const busy = !!progress;

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

  function start(message: string) {
    pending.current = true;
    setProgress(message);
    setError(null);
    onBusyChange?.(true);
  }
  function finish() {
    pending.current = false;
    if (mounted.current) { setProgress(""); setSubmitting(false); onBusyChange?.(false); }
  }
  function release(url: string) {
    URL.revokeObjectURL(url);
    resources.current.delete(url);
  }
  function updateImage(image: Attachment) {
    if (mounted.current) setImages((current) => current.map((entry) => entry.key === image.key ? { ...image } : entry));
  }
  async function prepareImage(image: Attachment) {
    image.stage = "processing";
    image.error = undefined;
    updateImage(image);
    try {
      processor.current ??= createImageProcessor();
      image.file = await processor.current.process(image.file);
      image.processed = true;
    } catch (cause) {
      image.error = cause instanceof Error ? cause.message : "图片处理失败，请重试。";
      throw cause;
    } finally {
      image.stage = undefined;
      updateImage(image);
    }
  }
  async function addImages(files: File[]) {
    if (!files.length || pending.current || unavailable) return;
    if (images.length + files.length > COMMENT_IMAGE_COUNT) { setError("每条评论最多上传 10 张图片。"); return; }
    if (files.some((file) => !file.size || file.size > COMMENT_IMAGE_BYTES)) { setError("每张图片必须非空且不能超过 2 MiB。"); return; }
    start("正在处理图片…");
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
          if (mounted.current) setError(`${image.error} 可移除此图片，或在发布时重试。`);
        }
      }
    } finally { finish(); }
  }

  async function submit() {
    if (pending.current || unavailable || !body.trim()) return;
    start("正在上传图片…");
    const next = images.map((image) => ({ ...image }));
    try {
      for (let index = 0; index < next.length; index++) {
        const image = next[index];
        if (image.uploaded) continue;
        if (!mounted.current) return;
        try {
          if (!image.processed) {
            setProgress(`正在处理图片 ${index + 1}/${next.length}…`);
            await prepareImage(image);
          }
          if (!mounted.current) return;
          setProgress(`正在上传图片 ${index + 1}/${next.length}…`);
          image.stage = "uploading";
          image.error = undefined;
          updateImage(image);
          const form = new FormData();
          form.set("image", image.file);
          form.set("clientId", image.key);
          form.set("targetKind", target.kind);
          form.set("targetId", String(target.id));
          const response = await fetch("/api/comments/images", { method: "POST", credentials: "same-origin", body: form });
          const result = await response.json() as { ok?: boolean; image?: CommentImage; detail?: string };
          if (!response.ok || !result.ok || !result.image) throw new Error(result.detail ?? "图片上传失败。");
          image.uploaded = result.image;
        } catch (cause) {
          image.error = cause instanceof Error ? cause.message : "网络请求失败，请重试。";
          throw new Error(image.error);
        } finally { image.stage = undefined; updateImage(image); }
      }
      if (!mounted.current) return;
      setProgress(replyToCommentId ? "正在发布回复…" : "正在发布评论…");
      setSubmitting(true);
      const payload = { body, replyToCommentId, imageIds: next.map((image) => image.uploaded!.id) };
      const serialized = JSON.stringify(payload);
      if (requestIdentity.current?.payload !== serialized)
        requestIdentity.current = { payload: serialized, key: crypto.randomUUID() };
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, requestKey: requestIdentity.current.key }),
      });
      const result = await response.json() as { ok?: boolean; comment?: CommentDto; detail?: string };
      if (!response.ok || !result.ok || !result.comment) throw new Error(result.detail ?? "评论发送失败。");
      if (!mounted.current) return;
      setBody("");
      setImages([]);
      for (const image of next) release(image.preview);
      requestIdentity.current = null;
      // Release the reply target before the parent closes this composer.
      finish();
      onCreated(result.comment);
      toast.success(replyToCommentId ? "回复已发布。" : "评论已发布。");
    } catch (cause) {
      if (mounted.current) toast.error(`${cause instanceof Error ? cause.message : "网络请求失败。"} 正文和图片已保留，请重试。`);
    } finally { finish(); }
  }

  return (
    <div className="grid min-w-0 gap-2" role="group" aria-label="评论编辑器"
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
        busy={busy || unavailable} topic={false} placeholder={placeholder} autoFocus={!!replyToCommentId}
        onChange={setBody} onBusyChange={() => {}} onError={setError} onCompositionChange={() => {}} />
      {images.length ? <ul className="flex flex-wrap gap-2" aria-label="待发布图片">
        {images.map((image, index) => <li key={image.key} className="w-24" aria-busy={!!image.stage}>
          <div className="relative aspect-square overflow-hidden rounded-md bg-muted/15">
            <img src={image.preview} alt={`待发布图片 ${index + 1}`} className="size-full object-cover" />
            {image.stage ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white" role="status">
                <LoaderCircle aria-hidden className="size-7 animate-spin motion-reduce:animate-none" />
                <span className="sr-only">图片 {index + 1} {image.stage === "processing" ? "正在处理" : "正在上传"}</span>
              </div>
            ) : (
              <Button type="button" size="icon" variant="neutral" className="absolute right-0 top-0" disabled={busy || unavailable}
                aria-label={`移除图片 ${index + 1}`} onClick={() => { release(image.preview); setImages((current) => current.filter((item) => item.key !== image.key)); }}><X aria-hidden /></Button>
            )}
          </div>
          {image.error ? <span className="text-xs text-destructive">{image.processed ? "上传失败" : "处理失败"}，发布时重试</span> : null}
        </li>)}
      </ul> : null}
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden disabled={busy || unavailable}
        onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addImages(files); }} />
      <EmojiPicker disabled={busy || unavailable} onSelect={(emoji, options) => editor.current?.insertEmoji(emoji, options)} onClose={() => editor.current?.focus()}>
        {(trigger) => <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">{trigger}<Button type="button" variant="ghost" size="sm" disabled={busy || unavailable || images.length >= COMMENT_IMAGE_COUNT}
            onClick={() => picker.current?.click()}><ImagePlus aria-hidden />上传图片</Button></div>
          <Button type="button" disabled={busy || unavailable || !body.trim()} onClick={() => void submit()}><Send aria-hidden />{submitting ? progress : replyToCommentId ? "发布回复" : "发布评论"}</Button>
        </div>}
      </EmojiPicker>
      {progress ? <p role="status" className="sr-only">{progress}</p> : null}
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
