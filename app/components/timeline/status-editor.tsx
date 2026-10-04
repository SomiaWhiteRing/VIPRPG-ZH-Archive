import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { BodyEditor, type BodyEditorHandle } from "@/app/components/comments/body-editor";
import { CommentComposerToolbar } from "@/app/components/comments/composer-layout";
import { EmojiPicker } from "@/app/components/emojis/picker";
import { FaceEmojiView } from "@/app/components/emojis/face-emoji";
import { bodyLength } from "@/lib/face-emojis";
import type { TimelineBodySegment } from "@/lib/dto/db/timeline";
import { useStatusImages, type StatusImageAttachment } from "./image-attachments";
import { Button } from "@/app/components/ui/button";
import { HeightBox } from "@/app/components/ui/height-box";
import { cn } from "@/lib/ui/cn";

export type StatusEditorHandle = { uploadImages: () => Promise<string[]> };
export const StatusEditor = forwardRef<StatusEditorHandle, {
  id: string; label: string; body: string; busy: boolean;
  onChange: (body: string) => void; onError: (message: string) => void; onCompositionChange: (value: boolean) => void;
  actions?: ReactNode;
  beforeCounter?: ReactNode;
  images: StatusImageAttachment[];
  onImagesChange: (images: StatusImageAttachment[]) => void;
  eventId?: number;
  onImagesBusyChange: (busy: boolean) => void;
}>(function StatusEditor({ id, label, body, busy, onChange, onError, onCompositionChange, beforeCounter, actions, images, onImagesChange, eventId, onImagesBusyChange }, ref) {
  const editor = useRef<BodyEditorHandle>(null);
  const attachments = useStatusImages({ images, onChange: onImagesChange, onError, busy, eventId });
  useEffect(() => { onImagesBusyChange(attachments.working); }, [attachments.working, onImagesBusyChange]);
  useImperativeHandle(ref, () => ({ uploadImages: attachments.upload }));
  return <div className="grid min-w-0 gap-2" {...attachments.handlers}>
    <BodyEditor ref={editor} inputId={id} inputLabel={label} body={body} images={[]} busy={busy || attachments.working} topic={false}
      textOnly allowMentions={false} maxLength={500} placeholder={eventId === undefined ? "写点什么……" : "写下回复……"} autoFocus={eventId !== undefined}
      onChange={(value) => onChange(value)} onBusyChange={() => {}} onError={onError} onCompositionChange={onCompositionChange} />
    {attachments.previews}
    {attachments.input}
    <EmojiPicker disabled={busy || attachments.working} onSelect={(emoji, options) => editor.current?.insertEmoji(emoji, options)} onClose={() => editor.current?.focus()}>
      {(trigger) => eventId !== undefined ? <CommentComposerToolbar tools={<>{trigger}{attachments.trigger}</>} actions={actions} /> : <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">{trigger}{attachments.trigger}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <span className="inline-flex shrink-0 items-center gap-1.5">
            {beforeCounter}
            <span className="text-xs text-muted" aria-live="off">{bodyLength(body)}/500</span>
          </span>
          {actions}
        </div>
      </div>}
    </EmojiPicker>
  </div>;
});

export function StatusBody({ segments, collapse = false }: { segments: TimelineBodySegment[]; collapse?: boolean }) {
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState<{ full: number; preview: number } | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!collapse || !content) return;
    function measure() {
      if (!content) return;
      const full = content.getBoundingClientRect().height;
      const preview = parseFloat(getComputedStyle(content).lineHeight) * 10;
      setSize((previous) => previous?.full === full && previous.preview === preview ? previous : { full, preview });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [collapse, segments]);

  const body = <div ref={contentRef} className="whitespace-pre-wrap wrap-anywhere text-[15px] leading-relaxed">
    {segments.map((segment, index) => segment.type === "text" ? segment.text : <FaceEmojiView key={index} emoji={segment.emoji} />)}
  </div>;
  if (!collapse) return body;
  const collapsible = size !== null && size.full > size.preview + 1;
  const collapsed = collapsible && !expanded;
  return <div className="text-[15px] leading-relaxed">
    <HeightBox id={contentId} height={size ? collapsed ? size.preview : size.full : undefined}
      className={cn("overflow-hidden transition-[height] duration-300 motion-reduce:transition-none", size === null && "max-h-[10lh]")}>
      {body}
    </HeightBox>
    {collapsible && <Button type="button" variant="ghost" size="sm" className="mt-1 min-h-8 gap-1 px-1 text-xs font-normal text-secondary"
      aria-controls={contentId} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {expanded ? "收起" : "展开"}<ChevronDown aria-hidden className={cn("transition-transform duration-300 motion-reduce:transition-none", expanded && "rotate-180")} />
    </Button>}
  </div>;
}
