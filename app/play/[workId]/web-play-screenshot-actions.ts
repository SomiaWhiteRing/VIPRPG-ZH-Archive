import { useEffect, useRef, useState } from "react";
import { zipSync, type Zippable } from "fflate";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { useToast } from "@/app/components/ui/toast";
import type { ScreenshotPreview } from "./web-play-screenshots";

export function useScreenshotActions(onDelete: (ids: string[]) => Promise<void>) {
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
      toast.success(`已打包 ${screenshots.length} 张截图。`);
    } catch {
      if (!controller.signal.aborted) toast.error("截图打包失败，请重试。");
    } finally {
      downloadRef.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }

  async function deleteScreenshots(screenshots: ScreenshotPreview[], description: string) {
    if (busy || !screenshots.length) return false;
    return confirm(description, {
      title: "删除截图", confirmLabel: "删除", destructive: true,
      action: async () => {
        setDeleting(true);
        try {
          await onDelete(screenshots.map(item => item.id));
          toast.success(`已删除 ${screenshots.length} 张截图。`);
        } catch { throw new Error("截图删除失败，请重试。"); }
        finally { setDeleting(false); }
      },
    });
  }
  return { busy, downloading, deleting, downloadScreenshots, deleteScreenshots };
}

export function screenshotFilename(screenshot: ScreenshotPreview): string {
  return `game-${screenshot.workId}-${screenshot.createdAt.replace(/[:.]/g, "-")}.png`;
}
