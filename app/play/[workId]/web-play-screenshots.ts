import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { formatFeedbackError, UiFeedbackError } from "@/lib/i18n/feedback";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerScreenshot } from "./web-play-player";
import { isAndroidClient } from "@/lib/browser/client-environment";
import { saveAndroidScreenshot } from "@/lib/browser/android-screenshots";
import {
  deleteWebPlayScreenshots,
  listWebPlayScreenshots,
  saveWebPlayScreenshot,
  type WebPlayScreenshot,
} from "./web-play-screenshot-db";

export type ScreenshotPreview = WebPlayScreenshot & { url: string };

export function useWebPlayScreenshots(workId: number, title: string) {
  const t = useMessages();
  const locale = useUiLocale();
  const [screenshots, setScreenshots] = useState<ScreenshotPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const lifetimeRef = useRef<AbortController | null>(null);
  const capturingRef = useRef(false);
  const urlsRef = useRef(new Set<string>());

  useEffect(() => {
    const lifetime = new AbortController();
    lifetimeRef.current = lifetime;
    const urls = urlsRef.current;
    setScreenshots([]);
    setLoading(true);
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
        // Screenshot history is optional and must not interrupt playing.
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

  const capture = useCallback(async (readScreenshot: () => Promise<PlayerScreenshot>) => {
    const signal = lifetimeRef.current?.signal;
    if (!signal || signal.aborted || loading || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    try {
      const android = isAndroidClient();
      signal.throwIfAborted();
      const capturedAt = Date.now();
      const image = await readScreenshot();
      signal.throwIfAborted();
      if (android) {
        await saveAndroidScreenshot(image.blob, workId, title, capturedAt);
        return signal.aborted ? undefined : { ok: true, message: t("play.screenshot.saved") };
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
      return { ok: true, message: t("play.screenshot.saved") };
    } catch (error) {
      if (signal.aborted) return;
      return {
        ok: false,
        message: error instanceof DOMException && error.name === "QuotaExceededError"
          ? t("play.screenshot.quota")
          : error instanceof Error
            ? t("play.screenshot.saveError", { reason: formatFeedbackError(error, locale, t("play.screenshot.saveFailed")) })
            : t("play.screenshot.saveFailed"),
      };
    } finally {
      capturingRef.current = false;
      if (!signal.aborted) setCapturing(false);
    }
  }, [loading, workId, title, locale, t]);

  const remove = useCallback(async (ids: string[]) => {
    const signal = lifetimeRef.current?.signal;
    if (!signal) throw new UiFeedbackError("play.screenshot.notReady");
    signal.throwIfAborted();
    const deletedIds = new Set(ids);
    const removed = screenshots.filter((item) => deletedIds.has(item.id));
    await deleteWebPlayScreenshots(removed.map((item) => item.id));
    signal.throwIfAborted();
    setScreenshots((current) => current.filter((item) => !deletedIds.has(item.id)));
    for (const item of removed) {
      URL.revokeObjectURL(item.url);
      urlsRef.current.delete(item.url);
    }
  }, [screenshots]);

  return { screenshots, loading, capturing, capture, remove };
}
