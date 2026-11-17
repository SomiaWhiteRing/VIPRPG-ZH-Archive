import { useMessages } from "@/lib/i18n/react";
import { UiFeedbackError } from "@/lib/i18n/feedback";
import { useEffect, useRef, useState } from "react";
import { zipSync, type Zippable } from "fflate";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { useToast } from "@/app/components/ui/toast";
import type { ScreenshotPreview } from "./web-play-screenshots";

export function useScreenshotActions(onDelete: (ids: string[]) => Promise<void>) {
  const t = useMessages();
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const downloadRef = useRef<AbortController | null>(null);
  const confirm = useConfirm(), toast = useToast();
  const busy = downloading || deleting;
  useEffect(() => () => downloadRef.current?.abort(), []);

  async function downloadScreenshots(screenshots: ScreenshotPreview[]) {
    if (busy || downloadRef.current || !screenshots.length) return;
    const controller = new AbortController();
    downloadRef.current = controller;
    setDownloading(true);
    try {
      const files: Zippable = {};
      for (const [index, screenshot] of screenshots.entries()) {
        const bytes = new Uint8Array(await screenshot.blob.arrayBuffer());
        controller.signal.throwIfAborted();
        files[`${index + 1}-${screenshotFilename(screenshot)}`] = bytes;
      }
      const blob = new Blob([new Uint8Array(zipSync(files, { level: 0 }))], { type: "application/zip" });
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `game-${screenshots[0].workId}-screenshots-${Date.now()}.zip`;
      document.body.appendChild(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
      toast.success(t("play.screenshot.packed", { count: screenshots.length }));
    } catch {
      if (!controller.signal.aborted) toast.error(t("play.screenshot.packFailed"));
    } finally {
      downloadRef.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }

  async function deleteScreenshots(screenshots: ScreenshotPreview[], description: string) {
    if (busy || !screenshots.length) return false;
    return confirm(description, {
      title: t("play.screenshot.delete"), confirmLabel: t("play.screenshot.deleteAction"), destructive: true,
      action: async () => {
        setDeleting(true);
        try {
          await onDelete(screenshots.map(item => item.id));
          toast.success(t("play.screenshot.deleted", { count: screenshots.length }));
        } catch { throw new UiFeedbackError("play.screenshot.deleteFailed"); }
        finally { setDeleting(false); }
      },
    });
  }
  return { busy, downloading, deleting, downloadScreenshots, deleteScreenshots };
}

export function screenshotFilename(screenshot: ScreenshotPreview): string {
  return `game-${screenshot.workId}-${screenshot.createdAt.replace(/[:.]/g, "-")}.png`;
}
