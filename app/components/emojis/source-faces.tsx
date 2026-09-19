import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Check } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { FaceSheetCanvas } from "@/app/components/ui/face-sheet-canvas";
import { cn } from "@/lib/ui/cn";
import {
  emojiCellKey,
  type FaceEmoji,
  type EmojiCharacter,
  type EmojiSheet,
} from "@/lib/face-emojis";
import { emojiRequest } from "./client";
import { FaceEmojiImage } from "@/app/components/ui/face-emoji-image";

export type EmojiSource =
  | { kind: "hot" }
  | { kind: "character"; character: EmojiCharacter; focus?: string }
  | { kind: "sheet"; sheet: EmojiSheet };
export const sourceKey = (source: EmojiSource) =>
  source.kind === "hot"
    ? "hot"
    : source.kind === "character"
      ? `character:${source.character.id}:${source.focus ?? ""}`
      : source.sheet.blobSha256;

type FacePage = {
  items: (FaceEmoji | EmojiSheet)[];
  more: boolean;
  offset?: number;
};

export function SourceFaces({
  source,
  defaults,
  owned,
  active,
  locateVersion,
  disabled,
  onSelect,
  onDragEmoji,
  onDragEnd,
}: {
  source: EmojiSource;
  defaults: FaceEmoji[];
  owned: Set<string>;
  active: FaceEmoji | null;
  locateVersion: number;
  disabled: boolean;
  onSelect: (emoji: FaceEmoji) => void;
  onDragEmoji: (emoji: FaceEmoji, event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  const [items, setItems] = useState<(FaceEmoji | EmojiSheet)[]>(
    source.kind === "sheet" ? [source.sheet] : [],
  );
  const [more, setMore] = useState(false);
  const [start, setStart] = useState(0);
  const [loading, setLoading] = useState(source.kind !== "sheet");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const failedDirection = useRef<"previous" | "next" | null>(null);
  const scrollAnchor = useRef<{ element: HTMLElement; top: number } | null>(
    null,
  );
  const scrolledTo = useRef("");
  const viewport = useRef<HTMLDivElement>(null);
  const activeKey = active ? emojiCellKey(active) : "";
  const activeBlob =
    active?.blobSha256 ??
    (source.kind === "character" ? source.focus : undefined);
  const requestUrl =
    source.kind === "hot"
      ? "/api/emojis?op=hot"
      : source.kind === "character"
        ? `/api/emojis?op=sheets&characterId=${source.character.id}`
        : "";
  const initialUrl =
    requestUrl +
    (source.kind === "character" && source.focus
      ? `&focus=${source.focus}`
      : "");
  useEffect(() => {
    if (!initialUrl) return;
    const request = new AbortController();
    controller.current = request;
    pending.current = true;
    failedDirection.current = null;
    void emojiRequest<FacePage>(initialUrl, undefined, request.signal)
      .then((page) => {
        if (request.signal.aborted) return;
        setItems(page.items);
        setStart(page.offset ?? 0);
        setMore(page.more);
        setError("");
      })
      .catch((error) => {
        if (!request.signal.aborted) setError(String(error));
      })
      .finally(() => {
        if (!request.signal.aborted) {
          pending.current = false;
          setLoading(false);
        }
      });
    return () => request.abort();
  }, [initialUrl, retry]);
  useLayoutEffect(() => {
    const container = viewport.current;
    if (!container) return;
    const anchor = scrollAnchor.current;
    if (anchor) {
      container.scrollTop +=
        anchor.element.getBoundingClientRect().top - anchor.top;
      scrollAnchor.current = null;
    }
    const targetKey = `${activeKey || activeBlob || ""}:${locateVersion}`;
    if (scrolledTo.current === targetKey) return;
    const target = container.querySelector<HTMLElement>(
      '[data-highlighted="true"]',
    );
    if (!target) return;
    const bounds = container.getBoundingClientRect();
    const itemBounds = target.getBoundingClientRect();
    if (itemBounds.top < bounds.top)
      container.scrollTop += itemBounds.top - bounds.top;
    else if (itemBounds.bottom > bounds.bottom)
      container.scrollTop += Math.min(
        itemBounds.top - bounds.top,
        itemBounds.bottom - bounds.bottom,
      );
    scrolledTo.current = targetKey;
  }, [activeKey, activeBlob, items, locateVersion]);
  async function loadPage(direction: "previous" | "next") {
    if (pending.current) return;
    const request = controller.current;
    if (!request || request.signal.aborted) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const offset =
        direction === "previous"
          ? Math.max(0, start - 24)
          : start + items.length;
      const page = await emojiRequest<FacePage>(
        `${requestUrl}&offset=${offset}`,
        undefined,
        request.signal,
      );
      if (request.signal.aborted) return;
      if (direction === "previous") {
        const element =
          viewport.current?.querySelector<HTMLElement>("[data-face-sheet]");
        if (element)
          scrollAnchor.current = {
            element,
            top: element.getBoundingClientRect().top,
          };
        setItems((current) => [...page.items, ...current]);
        setStart(page.offset ?? offset);
      } else {
        setItems((current) => [...current, ...page.items]);
        setMore(page.more);
      }
      failedDirection.current = null;
      setError("");
    } catch (error) {
      if (!request.signal.aborted) {
        failedDirection.current = direction;
        setError(String(error));
      }
    } finally {
      if (!request.signal.aborted) {
        pending.current = false;
        setLoading(false);
      }
    }
  }
  const discovery = (emojis: FaceEmoji[]) => (
    <div className="flex flex-wrap gap-2">
      {emojis.map((emoji) => {
        const key = emojiCellKey(emoji),
          collected = owned.has(key);
        return (
          <Button
            variant="ghost"
            size="icon"
            key={key}
            type="button"
            aria-label={`${collected ? "已添加" : "选择表情"}${emoji.users ? `，${emoji.users} 人使用` : ""}`}
            aria-pressed={activeKey === key}
            disabled={disabled}
            onClick={() => onSelect(emoji)}
            draggable={!disabled && emoji.available}
            onDragStart={(event) => onDragEmoji(emoji, event)}
            onDragEnd={onDragEnd}
            className={cn(
              "relative grid h-auto w-auto cursor-pointer justify-items-center gap-1 rounded border border-transparent p-1 font-normal hover:border-primary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default [&_svg]:size-3.5",
              activeKey === key &&
                "border-primary bg-primary/5 ring-1 ring-primary",
            )}
          >
            <FaceEmojiImage emoji={emoji} />
            {collected ? (
              <Check
                aria-hidden
                size={14}
                className="absolute right-0 top-0 rounded bg-primary text-primary-foreground"
              />
            ) : null}
            {emoji.users ? (
              <span className="text-[11px] text-muted">{emoji.users} 人</span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
  return (
    <div
      ref={viewport}
      className="h-80 min-h-0 overflow-auto p-3 [overflow-anchor:none] sm:h-auto"
    >
      {start > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mb-4"
          disabled={loading}
          onClick={() => void loadPage("previous")}
        >
          加载前面的脸图
        </Button>
      ) : null}
      {source.kind === "hot" ? (
        <>
          {discovery(items as FaceEmoji[])}
          {!loading && !error && !items.length ? (
            <div className="grid gap-4">
              <p className="text-sm text-muted">还没有热门表情</p>
              {defaults.length ? (
                <>
                  <strong className="text-xs text-muted">默认推荐</strong>
                  {discovery(defaults)}
                </>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <div className="grid grid-cols-2 content-start items-start gap-2 sm:grid-cols-3 sm:gap-3">
          {(items as EmojiSheet[]).map((sheet) => {
            const cell = (row: number, column: number): FaceEmoji => ({
              ...sheet,
              id: 0,
              row,
              column,
              available: true,
              sources:
                source.kind === "character"
                  ? [{ id: source.character.id, name: source.character.name }]
                  : [],
            });
            return (
              <div
                key={sheet.blobSha256}
                data-face-sheet={sheet.blobSha256}
                data-highlighted={
                  activeBlob === sheet.blobSha256 ? "true" : undefined
                }
                className="min-w-0 max-w-full"
              >
                <FaceSheetCanvas
                  blobSha256={sheet.blobSha256}
                  width={sheet.width}
                  height={sheet.height}
                  scale={1}
                  fit
                  label="角色脸图选格"
                  disabled={disabled}
                  onSelectCell={(row, column) => onSelect(cell(row, column))}
                  onDragCell={(row, column, event) =>
                    onDragEmoji(cell(row, column), event)
                  }
                  onDragEnd={onDragEnd}
                  cellState={(row, column) => {
                    const key = emojiCellKey(cell(row, column));
                    return {
                      selected: activeKey === key,
                      collected: owned.has(key),
                      highlighted: activeKey === key,
                    };
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
      {loading ? (
        <p role="status" className="text-sm text-muted">
          正在加载…
        </p>
      ) : null}
      {source.kind !== "hot" && !loading && !error && !items.length ? (
        <p className="text-sm text-muted">该角色暂无可用脸图。</p>
      ) : null}
      {error ? (
        <div role="alert" className="text-sm">
          {error}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => {
              if (failedDirection.current) {
                void loadPage(failedDirection.current);
                return;
              }
              setLoading(true);
              setRetry((current) => current + 1);
            }}
          >
            重试
          </Button>
        </div>
      ) : null}
      {more && !error ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-4"
          disabled={loading}
          onClick={() => void loadPage("next")}
        >
          加载更多
        </Button>
      ) : null}
    </div>
  );
}
