import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { EmptyState } from "@/app/components/ui/empty-state";
import { ScreenshotThumbnail } from "@/app/play/[workId]/web-play-screenshot-gallery";
import { useScreenshotActions } from "@/app/play/[workId]/web-play-screenshot-actions";
import type { ScreenshotPreview } from "@/app/play/[workId]/web-play-screenshots";
import { formatDate, formatDateKey, parseTimestamp } from "@/lib/format";

export function ScreenshotGallery({ screenshots, loading, title, initialManaging, onDelete, containerRef, activeId, onView }: {
  screenshots: ScreenshotPreview[]; loading: boolean; title: string; initialManaging: boolean;
  onDelete: (ids: string[]) => Promise<void>; containerRef: RefObject<HTMLDivElement | null>;
  activeId: string | null; onView: (id: string | null) => void;
}) {
  const [managing, setManaging] = useState(initialManaging);
  const [selected, setSelected] = useState(new Set<string>());
  const trigger = useRef<HTMLButtonElement | null>(null);
  const { busy, downloading, deleting, downloadScreenshots, deleteScreenshots } = useScreenshotActions(onDelete);
  const selectedImages = screenshots.filter(shot => selected.has(shot.id));
  const activeIndex = screenshots.findIndex(shot => shot.id === activeId);
  const groups = new Map<string, ScreenshotPreview[]>();
  for (const shot of screenshots) {
    const date = formatDateKey(parseTimestamp(shot.createdAt));
    const group = groups.get(date);
    if (group) group.push(shot);
    else groups.set(date, [shot]);
  }

  function select(shots: ScreenshotPreview[], checked: boolean) {
    setSelected(current => {
      const next = new Set(current);
      for (const shot of shots) { if (checked) next.add(shot.id); else next.delete(shot.id); }
      return next;
    });
  }

  return <section className="local-library-gallery min-w-0" aria-label="本地截图">
    <div className="local-library-gallery-toolbar">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className={`${managing ? "max-[640px]:sr-only " : ""}flex items-baseline gap-2 text-sm font-semibold`}>截图 <span className="font-mono text-xs font-normal text-muted">{loading ? "—" : screenshots.length}</span></h2>
        {managing ? <Label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs"><Checkbox className="bg-transparent shadow-none" disabled={busy || loading || !screenshots.length} aria-label="全选截图"
          checked={selectedImages.length && selectedImages.length === screenshots.length ? true : selectedImages.length ? "indeterminate" : false} onCheckedChange={checked => select(screenshots, checked === true)} />全选</Label> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {managing ? <>
          <span className="text-xs tabular-nums text-muted" role="status" aria-label={`已选 ${selectedImages.length} 张`}><span className="hidden sm:inline">已选 </span>{selectedImages.length}<span className="hidden sm:inline"> 张</span></span>
          <Button type="button" variant="ghost" size="icon" className="size-8" disabled={busy || !selectedImages.length} aria-label="批量下载截图" onClick={() => void downloadScreenshots(selectedImages)}>{downloading ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}</Button>
          <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" disabled={busy || !selectedImages.length} aria-label="批量删除截图" onClick={async () => { if (await deleteScreenshots(selectedImages, `确认删除所选 ${selectedImages.length} 张截图？删除后无法恢复。`)) setSelected(new Set()); }}>{deleting ? <LoaderCircle aria-hidden className="animate-spin" /> : <Trash2 aria-hidden />}</Button>
        </> : null}
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setManaging(value => !value); setSelected(new Set()); }}>{managing ? "完成" : "管理截图"}</Button>
      </div>
    </div>
    {loading ? <p role="status" className="py-12 text-center text-sm text-muted">读取本地截图…</p>
      : screenshots.length ? <div className="space-y-6">{[...groups].map(([date, shots]) => {
        const label = formatDate(shots[0].createdAt, { time: false });
        const count = shots.filter(shot => selected.has(shot.id)).length;
        return <section key={date} aria-label={label}>
          <div className="local-library-date mb-2 flex h-6 items-center gap-2">
            {managing ? <Checkbox className="bg-transparent shadow-none" disabled={busy} aria-label={`全选 ${label} 的截图`} checked={count === shots.length ? true : count ? "indeterminate" : false} onCheckedChange={checked => select(shots, checked === true)} /> : null}
            <h3 className="text-xs font-medium text-muted">{label}</h3>
          </div>
          <ul className="local-library-grid grid grid-cols-3 gap-2.5 min-[641px]:grid-cols-4">{shots.map(shot => {
            const label = `${title} · 第 ${screenshots.indexOf(shot) + 1} 张`;
            return <li key={shot.id} className="relative min-w-0" data-selected={managing && selected.has(shot.id)}>
              <ScreenshotThumbnail screenshot={shot} label={label} className="local-library-tile rounded-none" onClick={event => { trigger.current = event.currentTarget; onView(shot.id); }} />
              {managing ? <Label className="absolute left-1 top-1 flex size-7 cursor-pointer items-center justify-center"><Checkbox className="bg-transparent shadow-none" disabled={busy} aria-label={`选择截图：${label}`} checked={selected.has(shot.id)} onCheckedChange={checked => select([shot], checked === true)} /></Label> : null}
            </li>;
          })}</ul>
        </section>;
      })}</div> : <EmptyState title="没有本地截图。" className="py-16 text-center" />}
    {activeIndex >= 0 && containerRef.current ? <ScreenshotViewer screenshots={screenshots} title={title} index={activeIndex} container={containerRef.current} trigger={trigger.current}
      onChange={index => onView(screenshots[index].id)} onClose={() => onView(null)} /> : null}
  </section>;
}

function ScreenshotViewer({ screenshots, title, index, container, trigger, onChange, onClose }: {
  screenshots: ScreenshotPreview[]; title: string; index: number; container: HTMLElement;
  trigger: HTMLButtonElement | null; onChange: (index: number) => void; onClose: () => void;
}) {
  const activeThumbnail = useRef<HTMLLIElement | null>(null);
  const backButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { activeThumbnail.current?.scrollIntoView({ block: "nearest", inline: "center" }); }, [index]);
  useEffect(() => {
    backButton.current?.focus({ preventScroll: true });
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [trigger]);
  const shot = screenshots[index];
  return createPortal(
      <section aria-label="截图查看器" className="local-library-viewer absolute inset-0 z-10 grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
        onKeyDown={event => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            onChange(Math.max(0, Math.min(screenshots.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))));
          }
        }}>
        <header className="local-library-viewer-toolbar flex min-w-0 items-center justify-between gap-3 px-3 py-3 sm:px-5">
          <Button ref={backButton} type="button" size="sm" variant="ghost" className="local-library-viewer-back focus-visible:ring-primary focus-visible:ring-offset-0" onClick={onClose}>←返回列表</Button>
          <span className="shrink-0 font-mono text-xs tabular-nums" role="status">{index + 1} / {screenshots.length}</span>
        </header>
        <div className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1 sm:px-5">
          <Button type="button" size="icon" variant="ghost" className="local-library-viewer-arrow focus-visible:ring-primary focus-visible:ring-offset-0" disabled={index === 0} onClick={() => onChange(index - 1)} aria-label="上一张截图"><ChevronLeft aria-hidden /></Button>
          <div className="flex h-full min-h-0 min-w-0 items-center justify-center"><img key={shot.id} src={shot.url} alt={`${title} · 第 ${index + 1} 张`} width={shot.width} height={shot.height} className="local-library-viewer-image h-auto w-auto max-h-full max-w-full object-contain [image-rendering:pixelated]" /></div>
          <Button type="button" size="icon" variant="ghost" className="local-library-viewer-arrow focus-visible:ring-primary focus-visible:ring-offset-0" disabled={index === screenshots.length - 1} onClick={() => onChange(index + 1)} aria-label="下一张截图"><ChevronRight aria-hidden /></Button>
        </div>
        <nav className="local-library-filmstrip min-w-0 px-1 pb-3 pt-3 sm:px-3" aria-label="截图缩略图">
          <ul className="flex gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden motion-reduce:scroll-auto">{screenshots.map((thumbnail, position) => <li key={thumbnail.id} ref={position === index ? activeThumbnail : undefined} className="w-20 shrink-0 sm:w-24">
            <ScreenshotThumbnail screenshot={thumbnail} label={`第 ${position + 1} 张`} selected={position === index} onClick={() => onChange(position)} className="rounded-none" />
          </li>)}</ul>
        </nav>
      </section>, container);
}
