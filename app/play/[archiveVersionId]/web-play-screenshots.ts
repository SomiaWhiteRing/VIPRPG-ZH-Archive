import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerSession } from "./web-play-player";
import { isAndroidClient } from "@/lib/browser/client-environment";
import { ensureAndroidScreenshotDirectory, saveAndroidScreenshot } from "@/lib/browser/android-screenshots";
import {
  listWebPlayScreenshots,
  saveWebPlayScreenshot,
  type WebPlayScreenshot,
} from "./web-play-screenshot-db";

export type ScreenshotPreview = WebPlayScreenshot & { url: string };

export function useWebPlayScreenshots(workId: number, title: string) {
  const [screenshots, setScreenshots] = useState<ScreenshotPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lifetimeRef = useRef<AbortController | null>(null);
  const capturingRef = useRef(false);
  const urlsRef = useRef(new Set<string>());

  useEffect(() => {
    const lifetime = new AbortController();
    lifetimeRef.current = lifetime;
    const urls = urlsRef.current;
    setScreenshots([]);
    setLoading(true);
    setLoadError(null);
    if (isAndroidClient()) setLoading(false);
    else void listWebPlayScreenshots(workId)
      .then((rows) => {
        if (lifetime.signal.aborted) return;
        setScreenshots(rows.map((row) => {
          const url = URL.createObjectURL(row.blob);
          urls.add(url);
          return { ...row, url };
        }));
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setLoadError("读取本地截图失败，请刷新后重试。");
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setLoading(false);
      });
    return () => {
      lifetime.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, [workId]);

  const capture = useCallback(async (player: PlayerSession | null) => {
    const signal = lifetimeRef.current?.signal;
    if (!player || !signal || signal.aborted || loading || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    try {
      const android = isAndroidClient();
      if (android && !await ensureAndroidScreenshotDirectory()) return { ok: false, message: "未选择截图目录，截图未保存。" };
      signal.throwIfAborted();
      const capturedAt = Date.now();
      const image = await player.captureScreenshot();
      signal.throwIfAborted();
      if (android) {
        await saveAndroidScreenshot(image.blob, workId, title, capturedAt);
        return signal.aborted ? undefined : { ok: true, message: "截图已保存到所选目录。" };
      }
      const screenshot: WebPlayScreenshot = {
        ...image,
        id: crypto.randomUUID(),
        workId,
        createdAt: new Date().toISOString(),
      };
      await saveWebPlayScreenshot(screenshot);
      if (signal.aborted) return;
      const url = URL.createObjectURL(screenshot.blob);
      urlsRef.current.add(url);
      setScreenshots((current) => [{ ...screenshot, url }, ...current]);
      return { ok: true, message: "截图已保存。" };
    } catch (error) {
      if (signal.aborted) return;
      return {
        ok: false,
        message: error instanceof DOMException && error.name === "QuotaExceededError"
          ? "浏览器存储空间不足，截图未保存。"
          : error instanceof Error
            ? `截图未保存：${error.message}`
            : "截图未保存，请检查浏览器本地存储后重试。",
      };
    } finally {
      capturingRef.current = false;
      if (!signal.aborted) setCapturing(false);
    }
  }, [loading, workId, title]);

  return { screenshots, loading, capturing, loadError, capture };
}
