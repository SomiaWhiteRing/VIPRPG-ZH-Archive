import { ImageLightbox } from "@/app/components/media/image-lightbox";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { zipSync, type Zippable } from "fflate";
import { ChevronLeft, ChevronRight, Download, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import LightboxDownload from "yet-another-react-lightbox/plugins/download";
import type { ScreenshotPreview } from "./web-play-screenshots";

const PAGE_SIZE = 6;
type DownloadScope = "selected" | "page" | "all";

export function WebPlayScreenshotGallery({
  screenshots,
  title,
}: {
  screenshots: ScreenshotPreview[];
  title: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [downloadScope, setDownloadScope] = useState<DownloadScope>("all");
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const downloadRef = useRef<AbortController | null>(null);
  const selectPageId = useId();
  const activeIndex = screenshots.findIndex((item) => item.id === activeId);
  const totalPages = Math.max(1, Math.ceil(screenshots.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageScreenshots = screenshots.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selectedScreenshots = screenshots.filter((item) => selectedIds.has(item.id));
  const pageSelectedCount = pageScreenshots.filter((item) => selectedIds.has(item.id)).length;
  const downloadScreenshots = downloadScope === "selected"
    ? selectedScreenshots
    : downloadScope === "page" ? pageScreenshots : screenshots;

  useEffect(() => () => downloadRef.current?.abort(), []);

  function selectScreenshots(items: ScreenshotPreview[], checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
    setDownloadScope("selected");
    setDownloadMessage(null);
  }

  async function downloadBatch() {
    if (downloadRef.current || !downloadScreenshots.length) return;
    const controller = new AbortController();
    downloadRef.current = controller;
    setDownloading(true);
    setDownloadMessage(null);
    try {
      const blob = await createScreenshotZip(downloadScreenshots, controller.signal);
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `game-${downloadScreenshots[0].workId}-screenshots-${Date.now()}.zip`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      setDownloadMessage(`已打包 ${downloadScreenshots.length} 张截图。`);
    } catch {
      if (!controller.signal.aborted) setDownloadMessage("截图打包失败，请重试。");
    } finally {
      downloadRef.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }

  if (!screenshots.length) return null;

  return (
    <Card
      aria-label="截图画廊"
      className="order-1 min-w-0 rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-bold">截图画廊</h2>
        <span className="font-mono text-xs text-muted">{screenshots.length}</span>
      </div>
      <div className="mb-2 flex min-h-10 flex-wrap items-center justify-between gap-x-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={pageSelectedCount === pageScreenshots.length ? true : pageSelectedCount ? "indeterminate" : false}
            id={selectPageId}
            onCheckedChange={(checked) => selectScreenshots(pageScreenshots, checked === true)}
          />
          <Label className="cursor-pointer text-xs" htmlFor={selectPageId}>全选本页</Label>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted" role="status">已选 {selectedScreenshots.length} 张</span>
          <Button
            aria-label="清空截图选择"
            disabled={!selectedScreenshots.length}
            onClick={() => setSelectedIds(new Set())}
            size="icon"
            title="清空选择"
            type="button"
            variant="ghost"
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">
        {pageScreenshots.map((screenshot) => {
          const capturedAt = new Date(screenshot.createdAt).toLocaleString("zh-CN", { hour12: false });
          const label = `${title} · ${capturedAt}`;
          return (
            <li className="min-w-0" key={screenshot.id}>
              <Button
                aria-label={`查看截图：${label}`}
                className="block aspect-4/3 h-auto min-h-0 w-full overflow-hidden rounded-md bg-black p-0 hover:bg-black"
                onClick={() => setActiveId(screenshot.id)}
                type="button"
                variant="ghost"
              >
                <img
                  alt={label}
                  className="block h-full w-full object-contain [image-rendering:pixelated]"
                  height={screenshot.height}
                  loading="lazy"
                  src={screenshot.url}
                  width={screenshot.width}
                />
              </Button>
              <div className="mt-1 flex items-center gap-1">
                <Checkbox
                  aria-label={`选择截图：${label}`}
                  checked={selectedIds.has(screenshot.id)}
                  onCheckedChange={(checked) => selectScreenshots([screenshot], checked === true)}
                />
                <time className="min-w-0 flex-1 break-words text-xs text-muted" dateTime={screenshot.createdAt}>
                  {capturedAt}
                </time>
                <a
                  aria-label={`下载截图：${label}`}
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                  download={screenshotFilename(screenshot)}
                  href={screenshot.url}
                  title="下载截图"
                >
                  <Download aria-hidden />
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      {totalPages > 1 ? (
        <nav aria-label="截图分页" className="mt-3 flex items-center justify-center gap-2">
          <Button
            aria-label="上一页截图"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
            size="icon"
            title="上一页"
            type="button"
            variant="outline"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="min-w-20 text-center font-mono text-xs tabular-nums text-muted" role="status">
            {currentPage + 1} / {totalPages}
          </span>
          <Button
            aria-label="下一页截图"
            disabled={currentPage === totalPages - 1}
            onClick={() => setPage(currentPage + 1)}
            size="icon"
            title="下一页"
            type="button"
            variant="outline"
          >
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      ) : null}
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <SelectField
          aria-label="截图批量下载范围"
          className="min-w-0 flex-1"
          disabled={downloading}
          onValueChange={(value) => {
            setDownloadScope(value as DownloadScope);
            setDownloadMessage(null);
          }}
          options={[
            { value: "selected", label: `所选截图（${selectedScreenshots.length}）` },
            { value: "page", label: `本页截图（${pageScreenshots.length}）` },
            { value: "all", label: `全部截图（${screenshots.length}）` },
          ]}
          value={downloadScope}
        />
        <Button
          aria-label={downloading ? "正在打包截图" : "批量下载截图"}
          disabled={downloading || !downloadScreenshots.length}
          onClick={() => void downloadBatch()}
          size="icon"
          title="批量下载 ZIP"
          type="button"
          variant="outline"
        >
          {downloading ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}
        </Button>
      </div>
      {downloadMessage ? <p className="mb-0 mt-2 text-xs text-muted" role="status">{downloadMessage}</p> : null}
      {activeIndex >= 0 ? (
        <ImageLightbox
          open
          close={() => setActiveId(null)}
          index={activeIndex}
          slides={screenshots.map((screenshot) => ({
            src: screenshot.url,
            width: screenshot.width,
            height: screenshot.height,
            alt: title,
            download: { url: screenshot.url, filename: screenshotFilename(screenshot) },
          }))}
          plugins={[LightboxDownload]}
          pixelated
          labels={{ Download: "下载截图" }}
        />
      ) : null}
    </Card>
  );
}

function screenshotFilename(screenshot: ScreenshotPreview): string {
  return `game-${screenshot.workId}-${screenshot.createdAt.replace(/[:.]/g, "-")}.png`;
}

async function createScreenshotZip(screenshots: ScreenshotPreview[], signal: AbortSignal): Promise<Blob> {
  const files: Zippable = {};
  for (const [index, screenshot] of screenshots.entries()) {
    const bytes = new Uint8Array(await screenshot.blob.arrayBuffer());
    signal.throwIfAborted();
    // The ordinal keeps simultaneous captures from overwriting one another.
    files[`${index + 1}-${screenshotFilename(screenshot)}`] = bytes;
  }
  return new Blob([new Uint8Array(zipSync(files, { level: 0 }))], { type: "application/zip" });
}
