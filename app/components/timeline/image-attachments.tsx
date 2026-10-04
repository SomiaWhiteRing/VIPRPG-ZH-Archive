import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { createImageProcessor } from "@/app/discussions/image-processor";
import { requestJson } from "@/lib/ui/api-response";
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
      if (!image.file) throw new Error("请选择图片文件。");
      processor.current ??= createImageProcessor();
      image.file = await processor.current.process(image.file);
      image.processed = true;
    } catch (error) { image.error = error instanceof Error ? error.message : "图片处理失败，请重试。"; throw error; }
    finally { image.stage = undefined; stage(image); }
  }
  async function add(files: File[]) {
    if (!files.length || busy || pending.current) return;
    if (current.current.length + files.length > COMMENT_IMAGE_COUNT) { onError("每条内容最多上传 10 张图片。"); return; }
    if (files.some((file) => !file.size || file.size > COMMENT_IMAGE_BYTES)) { onError("每张图片必须非空且不能超过 2 MiB。"); return; }
    start();
    setProgress("正在处理图片…");
    const added = files.map((file): StatusImageAttachment => ({ key: crypto.randomUUID(), file, processed: false, stage: "processing" }));
    update([...current.current, ...added]);
    try {
      for (const image of added) {
        if (!mounted.current) return;
        try { await prepare(image); }
        catch { if (mounted.current) onError(`${image.error} 可移除此图片，或在发布时重试。`); }
      }
    } finally { finish(); }
  }
  async function upload() {
    if (pending.current) throw new Error("图片仍在处理中，请稍后发布。");
    start();
    const next = current.current.map((image) => ({ ...image }));
    try {
      for (let index = 0; index < next.length; index++) {
        const image = next[index];
        if (image.uploaded) continue;
        if (!mounted.current) throw new Error("发布已中止，草稿已保留。");
        try {
          if (!image.processed) await prepare(image);
          if (!mounted.current) throw new Error("发布已中止，草稿已保留。");
          setProgress(`正在上传图片 ${index + 1}/${next.length}…`);
          image.stage = "uploading";
          image.error = undefined;
          stage(image);
          if (!image.file) throw new Error("请选择图片文件。");
          const form = new FormData();
          form.set("image", image.file);
          form.set("clientId", image.key);
          form.set("targetKind", eventId === undefined ? "timelineStatus" : "timelineReply");
          if (eventId !== undefined) form.set("targetId", String(eventId));
          const result = await requestJson<{ image?: CommentImage }>("/api/comments/images", { method: "POST", body: form }, "图片上传失败");
          if (!result.image) throw new Error("图片已上传，但未返回图片资料，请重试。");
          image.uploaded = result.image;
        } catch (error) { image.error = error instanceof Error ? error.message : "图片上传失败，请重试。"; throw error; }
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
    previews: images.length ? <ul className="flex flex-wrap gap-2" aria-label="待发布图片">
      {images.map((image, index) => <li key={image.key} className="w-24" aria-busy={!!image.stage}>
        <div className="relative aspect-square overflow-hidden rounded-md bg-muted/15">
          <ImagePreview image={image} index={index} />
          {image.stage ? <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white" role="status">
            <LoaderCircle aria-hidden className="size-7 animate-spin motion-reduce:animate-none" /><span className="sr-only">图片 {index + 1} {image.stage === "processing" ? "正在处理" : "正在上传"}</span>
          </div> : <Button type="button" size="icon" variant="neutral" className="absolute right-0 top-0" disabled={busy || working}
            aria-label={`移除图片 ${index + 1}`} onClick={() => update(current.current.filter((entry) => entry.key !== image.key))}><X aria-hidden /></Button>}
        </div>
        {image.error && <span className="text-xs text-destructive">{image.processed ? "上传失败" : "处理失败"}，发布时重试</span>}
      </li>)}
    </ul> : null,
    input: <><input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden disabled={busy || working}
      onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void add(files); }} />
      {progress && <p role="status" className="sr-only">{progress}</p>}</>,
    trigger: <Button type="button" variant="ghost" size="icon" aria-label="上传图片" title="上传图片" disabled={busy || working || images.length >= COMMENT_IMAGE_COUNT} onClick={() => picker.current?.click()}><ImagePlus aria-hidden /></Button>,
  };
}

function ImagePreview({ image, index }: { image: StatusImageAttachment; index: number }) {
  const url = useMemo(() => image.file ? URL.createObjectURL(image.file) : image.uploaded?.url ?? "", [image.file, image.uploaded?.url]);
  useEffect(() => () => { if (image.file) URL.revokeObjectURL(url); }, [image.file, url]);
  return <img src={url} alt={`待发布图片 ${index + 1}`} className="size-full object-cover" />;
}
