import { useEffect, useRef, useState } from "react";
import type { FaceEmoji, EmojiSheet } from "@/lib/face-emojis";
import type { EmojiSource } from "./source-faces";
import { emojiRequest } from "./client";

type FacePage = {
  items: (FaceEmoji | EmojiSheet)[];
  more: boolean;
  offset?: number;
};
type PageState = {
  key: string;
  items: FacePage["items"];
  more: boolean;
  start: number;
  loading: boolean;
  error: string;
};

export function useSourceFacePages(source: EmojiSource | null, enabled = true) {
  const requestUrl =
    source?.kind === "hot"
      ? "/api/emojis?op=hot"
      : source?.kind === "character"
        ? `/api/emojis?op=sheets&characterId=${source.character.id}`
        : "";
  const initialUrl = requestUrl +
    (source?.kind === "character" && source.focus ? `&focus=${source.focus}` : "");
  const key = initialUrl || (source?.kind === "sheet" ? source.sheet.blobSha256 : "");
  const initialPage: PageState = {
    key,
    items: source?.kind === "sheet" ? [source.sheet] : [],
    more: false,
    start: 0,
    loading: enabled && !!initialUrl,
    error: "",
  };
  const [state, setState] = useState(initialPage);
  const [retry, setRetry] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const loadedKey = useRef<string | null>(null);
  const failedDirection = useRef<"previous" | "next" | null>(null);
  const page = state.key === key ? state : initialPage;

  useEffect(() => {
    if (!enabled || !initialUrl) return;
    const request = new AbortController();
    controller.current = request;
    pending.current = false;
    // ponytail: Cache only the current source; reopening keeps appended sheets and scroll.
    if (loadedKey.current === key) {
      setState((current) => current.loading ? { ...current, loading: false } : current);
      return () => request.abort();
    }
    loadedKey.current = null;
    pending.current = true;
    failedDirection.current = null;
    setState({ key, items: [], more: false, start: 0, loading: true, error: "" });
    void emojiRequest<FacePage>(initialUrl, undefined, request.signal)
      .then((result) => {
        if (request.signal.aborted) return;
        loadedKey.current = key;
        setState({ key, items: result.items, more: result.more, start: result.offset ?? 0, loading: false, error: "" });
      })
      .catch((error) => {
        if (!request.signal.aborted)
          setState((current) => ({ ...current, loading: false, error: String(error) }));
      })
      .finally(() => {
        if (!request.signal.aborted) pending.current = false;
      });
    return () => request.abort();
  }, [enabled, initialUrl, key, retry]);

  async function loadPage(direction: "previous" | "next" = "next", beforePrepend?: () => void) {
    if (pending.current || !enabled || !requestUrl) return;
    const request = controller.current;
    if (!request || request.signal.aborted) return;
    pending.current = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const offset = direction === "previous" ? Math.max(0, page.start - 24) : page.start + page.items.length;
      const result = await emojiRequest<FacePage>(`${requestUrl}&offset=${offset}`, undefined, request.signal);
      if (request.signal.aborted) return;
      if (direction === "previous") beforePrepend?.();
      setState((current) => direction === "previous"
        ? { ...current, items: [...result.items, ...current.items], start: result.offset ?? offset, loading: false }
        : { ...current, items: [...current.items, ...result.items], more: result.more, loading: false });
      failedDirection.current = null;
    } catch (error) {
      if (!request.signal.aborted) {
        failedDirection.current = direction;
        setState((current) => ({ ...current, loading: false, error: String(error) }));
      }
    } finally {
      if (!request.signal.aborted) pending.current = false;
    }
  }

  function retryPage(beforePrepend?: () => void) {
    if (pending.current || !enabled) return;
    if (failedDirection.current) {
      void loadPage(failedDirection.current, beforePrepend);
    } else {
      loadedKey.current = null;
      setRetry((current) => current + 1);
    }
  }

  return { ...page, loadPage, retryPage };
}
