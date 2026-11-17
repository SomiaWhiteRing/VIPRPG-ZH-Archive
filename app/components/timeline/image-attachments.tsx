import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { Button } from "@/app/components/ui/button";
import { createImageProcessor } from "@/app/discussions/image-processor";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";
import { COMMENT_IMAGE_BYTES, COMMENT_IMAGE_COUNT, type CommentImage } from "@/lib/comment-images";

export type StatusImageAttachment = {
  key: string;
  file?: File;
  processed: boolean;
  uploaded?: CommentImage;
  stage?: "processing" | "uploading";
  error?: string;
};

export function useStatusImages({ images, onChange, onError, busy, eventId }: {
  images: StatusImageAttachment[]; onChange: (images: StatusImageAttachment[]) => void;
  onError: (message: string) => void; busy: boolean; eventId?: number;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const current = useRef(images);
  current.current = images;
  const change = useRef(onChange);
  change.current = onChange;
  const processor = useRef<ReturnType<typeof createImageProcessor> | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; processor.current?.dispose(); processor.current = null; };
  }, []);

  function update(next: StatusImageAttachment[]) {
    current.current = next;
    if (mounted.current) change.current(next);
  }
  function stage(image: StatusImageAttachment) {
    update(current.current.map((entry) => entry.key === image.key ? { ...image } : entry));
  }
  function start() { pending.current = true; setWorking(true); }
  function finish() { pending.current = false; if (mounted.current) { setWorking(false); setProgress(""); } }
  async function prepare(image: StatusImageAttachment) {
    image.stage = "processing";
    image.error = undefined;
    stage(image);
    try {
      if (!image.file) throw new Error(t("image.choose"));
      processor.current ??= createImageProcessor();
      image.file = await processor.current.process(image.file, locale);
      image.processed = true;
    } catch (error) { image.error = error instanceof Error ? error.message : t("image.processFailed"); throw error; }
    finally { image.stage = undefined; stage(image); }
  }
  async function add(files: File[]) {
    if (!files.length || busy || pending.current) return;
    if (current.current.length + files.length > COMMENT_IMAGE_COUNT) { onError(t("timeline.image.limit", { count: COMMENT_IMAGE_COUNT })); return; }
    if (files.some((file) => !file.size || file.size > COMMENT_IMAGE_BYTES)) { onError(t("image.size")); return; }
    start();
    setProgress(t("image.processing"));
    const added = files.map((file): StatusImageAttachment => ({ key: crypto.randomUUID(), file, processed: false, stage: "processing" }));
    update([...current.current, ...added]);
    try {
      for (const image of added) {
        if (!mounted.current) return;
        try { await prepare(image); }
        catch { if (mounted.current) onError(t("image.retryOrRemove", { error: image.error ?? t("image.processFailed") })); }
      }
    } finally { finish(); }
  }
  async function upload() {
    if (pending.current) throw new Error(t("timeline.image.busy"));
    start();
    const next = current.current.map((image) => ({ ...image }));
    try {
      for (let index = 0; index < next.length; index++) {
        const image = next[index];
        if (image.uploaded) continue;
        if (!mounted.current) throw new Error(t("timeline.image.aborted"));
        try {
          if (!image.processed) await prepare(image);
          if (!mounted.current) throw new Error(t("timeline.image.aborted"));
          setProgress(t("image.uploadIndex", { index: index + 1, total: next.length }));
          image.stage = "uploading";
          image.error = undefined;
          stage(image);
          if (!image.file) throw new Error(t("image.choose"));
          const form = new FormData();
          form.set("image", image.file);
          form.set("clientId", image.key);
          form.set("targetKind", eventId === undefined ? "timelineStatus" : "timelineReply");
          if (eventId !== undefined) form.set("targetId", String(eventId));
          const result = await requestJson<{ image?: CommentImage }>(`/api/comments/images?${UI_LOCALE_PARAM}=${locale}`, { method: "POST", body: form }, t("image.uploadFailed"));
          if (!result.image) throw new Error(t("image.missingResponse"));
          image.uploaded = result.image;
        } catch (error) { const message = error instanceof ApiResponseError ? error.messageFor(locale)
            : error instanceof Error ? error.message : t("image.uploadFailed");
          image.error = message;
          throw new Error(message); }
        finally { image.stage = undefined; stage(image); }
      }
      return next.map((image) => image.uploaded!.id);
    } finally { finish(); }
  }

  return {
    working, upload,
    handlers: {
      onPasteCapture: (event: React.ClipboardEvent<HTMLDivElement>) => {
        const files = Array.from(event.clipboardData.files);
        if (files.length) { event.preventDefault(); event.stopPropagation(); void add(files); }
      },
      onDragOver: (event: React.DragEvent<HTMLDivElement>) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); },
      onDropCapture: (event: React.DragEvent<HTMLDivElement>) => {
        const files = Array.from(event.dataTransfer.files);
        if (files.length) { event.preventDefault(); event.stopPropagation(); void add(files); }
      },
    },
    previews: images.length ? <ul className="flex flex-wrap gap-2" aria-label={t("image.pending")}>
      {images.map((image, index) => <li key={image.key} className="w-24" aria-busy={!!image.stage}>
        <div className="relative aspect-square overflow-hidden rounded-md bg-muted/15">
          <ImagePreview image={image} index={index} />
          {image.stage ? <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white" role="status">
            <LoaderCircle aria-hidden className="size-7 animate-spin motion-reduce:animate-none" /><span className="sr-only">{t("image.workIndex", { index: index + 1, stage: image.stage })}</span>
          </div> : <Button type="button" size="icon" variant="neutral" className="absolute right-0 top-0" disabled={busy || working}
            aria-label={t("image.removeIndex", { index: index + 1 })} onClick={() => update(current.current.filter((entry) => entry.key !== image.key))}><X aria-hidden /></Button>}
        </div>
        {image.error && <span className="text-xs text-destructive">{t("image.willRetry", { stage: image.processed ? "upload" : "processing" })}</span>}
      </li>)}
    </ul> : null,
    input: <><input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden disabled={busy || working}
      onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void add(files); }} />
      {progress && <p role="status" className="sr-only">{progress}</p>}</>,
    trigger: <Button type="button" variant="ghost" size="icon" aria-label={t("image.upload")} title={t("image.upload")} disabled={busy || working || images.length >= COMMENT_IMAGE_COUNT} onClick={() => picker.current?.click()}><ImagePlus aria-hidden /></Button>,
  };
}

function ImagePreview({ image, index }: { image: StatusImageAttachment; index: number }) {
  const t = useMessages();
  const url = useMemo(() => image.file ? URL.createObjectURL(image.file) : image.uploaded?.url ?? "", [image.file, image.uploaded?.url]);
  useEffect(() => () => { if (image.file) URL.revokeObjectURL(url); }, [image.file, url]);
  return <img src={url} alt={t("image.pendingIndex", { index: index + 1 })} className="size-full object-cover" />;
}
