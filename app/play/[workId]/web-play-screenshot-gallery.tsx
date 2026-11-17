import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { ImageLightbox } from "@/app/components/media/image-lightbox";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { DISPLAY_TIME_ZONE, parseTimestamp } from "@/lib/format";
import { ChevronLeft, ChevronRight, Download, LoaderCircle, Trash2, X } from "lucide-react";
import { useId, useState, type MouseEventHandler } from "react";
import LightboxDownload from "yet-another-react-lightbox/plugins/download";
import type { ScreenshotPreview } from "./web-play-screenshots";
import { screenshotFilename, useScreenshotActions } from "./web-play-screenshot-actions";

const PAGE_SIZE = 6;
type ScreenshotScope = "selected" | "page" | "all";

export function WebPlayScreenshotGallery({
  onDelete,
  screenshots,
  title,
}: {
  onDelete: (ids: string[]) => Promise<void>;
  screenshots: ScreenshotPreview[];
  title: string;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [scope, setScope] = useState<ScreenshotScope>("all");
  const { busy, downloading, deleting, downloadScreenshots, deleteScreenshots: deleteImages } = useScreenshotActions(onDelete);
  const selectPageId = useId();
  const activeIndex = screenshots.findIndex((item) => item.id === activeId);
  const totalPages = Math.max(1, Math.ceil(screenshots.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageScreenshots = screenshots.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selectedScreenshots = screenshots.filter((item) => selectedIds.has(item.id));
  const pageSelectedCount = pageScreenshots.filter((item) => selectedIds.has(item.id)).length;
  const batchScreenshots = scope === "selected"
    ? selectedScreenshots
    : scope === "page" ? pageScreenshots : screenshots;

  function selectScreenshots(items: ScreenshotPreview[], checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
    setScope("selected");
  }

  async function deleteScreenshots(items: ScreenshotPreview[], description: string) {
    const ids = new Set(items.map((item) => item.id));
    if (await deleteImages(items, description)) {
      setSelectedIds((current) => new Set([...current].filter((id) => !ids.has(id))));
      if (activeId && ids.has(activeId)) setActiveId(null);
      setPage(Math.min(currentPage, Math.max(0, Math.ceil((screenshots.length - ids.size) / PAGE_SIZE) - 1)));
    }
  }

  function deleteBatch() {
    return deleteScreenshots(batchScreenshots, t("play.screenshot.confirmBatch", { scope, count: batchScreenshots.length }));
  }

  if (!screenshots.length) return null;

  return (
    <Card
      aria-label={t("play.screenshot.gallery")}
      className="order-1 min-w-0 rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-bold">{t("play.screenshot.gallery")}</h2>
        <span className="font-mono text-xs text-muted">{screenshots.length.toLocaleString(locale)}</span>
      </div>
      <div className="mb-2 flex min-h-10 flex-wrap items-center justify-between gap-x-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={pageSelectedCount === pageScreenshots.length ? true : pageSelectedCount ? "indeterminate" : false}
            id={selectPageId}
            onCheckedChange={(checked) => selectScreenshots(pageScreenshots, checked === true)}
          />
          <Label className="cursor-pointer text-xs" htmlFor={selectPageId}>{t("play.screenshot.selectPage")}</Label>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted" role="status">{t("play.screenshot.selected", { count: selectedScreenshots.length })}</span>
          <Button
            aria-label={t("play.screenshot.clearSelection")}
            disabled={!selectedScreenshots.length}
            onClick={() => setSelectedIds(new Set())}
            size="icon"
            title={t("play.screenshot.clear")}
            type="button"
            variant="ghost"
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">
        {pageScreenshots.map((screenshot) => {
          const capturedAt = parseTimestamp(screenshot.createdAt).toLocaleString(locale, { timeZone: DISPLAY_TIME_ZONE, hour12: false });
          const label = `${title} · ${capturedAt}`;
          return (
            <li className="min-w-0" key={screenshot.id}>
              <ScreenshotThumbnail screenshot={screenshot} label={label} onClick={() => setActiveId(screenshot.id)} />
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <Checkbox
                  aria-label={t("play.screenshot.selectNamed", { label })}
                  checked={selectedIds.has(screenshot.id)}
                  onCheckedChange={(checked) => selectScreenshots([screenshot], checked === true)}
                />
                <time className="min-w-0 flex-1 basis-20 break-words text-xs text-muted" dateTime={screenshot.createdAt}>
                  {capturedAt}
                </time>
                <div className="ml-auto flex items-center gap-1">
                  <a
                    aria-label={t("play.screenshot.downloadNamed", { label })}
                    className={buttonVariants({ variant: "ghost", size: "icon" })}
                    download={screenshotFilename(screenshot)}
                    href={screenshot.url}
                    title={t("play.screenshot.download")}
                  >
                    <Download aria-hidden />
                  </a>
                  <Button
                    aria-label={t("play.screenshot.deleteNamed", { label })}
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => void deleteScreenshots([screenshot], t("play.screenshot.confirmDelete"))}
                    size="icon"
                    title={t("play.screenshot.delete")}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {totalPages > 1 ? (
        <nav aria-label={t("play.screenshot.pagination")} className="mt-3 flex items-center justify-center gap-2">
          <Button
            aria-label={t("play.screenshot.previousNamed")}
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
            size="icon"
            title={t("play.screenshot.previous")}
            type="button"
            variant="outline"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="min-w-20 text-center font-mono text-xs tabular-nums text-muted" role="status">
            {currentPage + 1} / {totalPages}
          </span>
          <Button
            aria-label={t("play.screenshot.nextNamed")}
            disabled={currentPage === totalPages - 1}
            onClick={() => setPage(currentPage + 1)}
            size="icon"
            title={t("play.screenshot.next")}
            type="button"
            variant="outline"
          >
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      ) : null}
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <SelectField
          aria-label={t("play.screenshot.scope")}
          className="min-w-0 flex-1"
          disabled={busy}
          onValueChange={(value) => {
            setScope(value as ScreenshotScope);
          }}
          options={[
            { value: "selected", label: t("play.screenshot.scope.selected", { count: selectedScreenshots.length }) },
            { value: "page", label: t("play.screenshot.scope.page", { count: pageScreenshots.length }) },
            { value: "all", label: t("play.screenshot.scope.all", { count: screenshots.length }) },
          ]}
          value={scope}
        />
        <Button
          aria-label={downloading ? t("play.screenshot.pack") : t("play.screenshot.batchDownload")}
          disabled={busy || !batchScreenshots.length}
          onClick={() => void downloadScreenshots(batchScreenshots)}
          size="icon"
          title={t("play.screenshot.downloadZip")}
          type="button"
          variant="outline"
        >
          {downloading ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}
        </Button>
        <Button
          aria-label={deleting ? t("play.screenshot.deleting") : t("play.screenshot.batchDelete")}
          className="text-destructive hover:border-destructive hover:text-destructive"
          disabled={busy || !batchScreenshots.length}
          onClick={() => void deleteBatch()}
          size="icon"
          title={t("play.screenshot.batchDelete")}
          type="button"
          variant="outline"
        >
          {deleting ? <LoaderCircle aria-hidden className="animate-spin" /> : <Trash2 aria-hidden />}
        </Button>
      </div>
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
          labels={{ Download: t("play.screenshot.download") }}
        />
      ) : null}
    </Card>
  );
}

export function ScreenshotThumbnail({ screenshot, label, onClick, className = "", selected }: { screenshot: ScreenshotPreview; label: string; onClick: MouseEventHandler<HTMLButtonElement>; className?: string; selected?: boolean }) {
  const t = useMessages();
  return <Button aria-label={t("play.screenshot.viewNamed", { label })} aria-pressed={selected} className={`block aspect-4/3 h-auto min-h-0 w-full overflow-hidden rounded-md bg-black p-0 hover:bg-black ${className}`}
    onClick={onClick} type="button" variant="ghost">
    <img alt={label} className="block h-full w-full object-contain [image-rendering:pixelated]" height={screenshot.height} loading="lazy" src={screenshot.url} width={screenshot.width} />
  </Button>;
}
