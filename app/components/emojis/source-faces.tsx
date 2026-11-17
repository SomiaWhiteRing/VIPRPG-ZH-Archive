import { useMessages } from "@/lib/i18n/react";
import { EmojiDragSource } from "@/app/components/ui/emoji-drag";
import {
  useLayoutEffect,
  memo,
  useRef,
} from "react";
import { Check } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { FaceSheetGrid } from "@/app/components/ui/face-sheet-grid";
import { cn } from "@/lib/ui/cn";
import {
  emojiCellKey,
  type FaceEmoji,
  type EmojiCharacter,
  type EmojiSheet,
} from "@/lib/face-emojis";
import { useSourceFacePages } from "./source-pages";
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

export const SourceFaces = memo(function SourceFaces({
  source,
  defaults,
  owned,
  active,
  selected,
  locateVersion,
  disabled,
  onSelect,
  dragDisabled,
  lifted,
  settling,
}: {
  source: EmojiSource;
  defaults: FaceEmoji[];
  owned: Set<string>;
  active: FaceEmoji | null;
  selected: Set<string> | null;
  locateVersion: number;
  disabled: boolean;
  onSelect: (emoji: FaceEmoji, additive?: boolean) => void;
  dragDisabled: boolean;
  lifted: Set<string>;
  settling: Set<string>;
}) {
  const t = useMessages();
  const { items, more, start, loading, error, loadPage, retryPage } = useSourceFacePages(source);
  const scrollAnchor = useRef<{ element: HTMLElement; top: number } | null>(
    null,
  );
  const scrolledTo = useRef("");
  const viewport = useRef<HTMLDivElement>(null);
  const activeKey = active ? emojiCellKey(active) : "";
  const activeBlob =
    active?.blobSha256 ??
    (source.kind === "character" ? source.focus : undefined);
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
  function anchorScroll() {
    const element = viewport.current?.querySelector<HTMLElement>("[data-face-sheet]");
    if (element) scrollAnchor.current = { element, top: element.getBoundingClientRect().top };
  }
  const discovery = (emojis: FaceEmoji[]) => (
    <div className="flex flex-wrap gap-2">
      {emojis.map((emoji) => {
        const key = emojiCellKey(emoji),
          collected = owned.has(key),
          isSelected = selected?.has(key) ?? activeKey === key;
        return (
          <EmojiDragSource key={key} emoji={emoji} disabled={dragDisabled || !emoji.available} lifted={lifted.has(key)} settling={settling.has(`source:${key}`)} onSelect={onSelect}>
          <Button
            variant="ghost"
            size="icon"
            key={key}
            type="button"
            aria-label={emoji.users ? t("emoji.source.usedBy", { label: t(collected ? "emoji.source.collected" : "emoji.picker.choose"), count: emoji.users }) : t(collected ? "emoji.source.collected" : "emoji.picker.choose")}
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onSelect(emoji)}
            className={cn(
              "relative grid h-auto w-auto cursor-pointer justify-items-center gap-1 rounded border border-transparent p-1 font-normal hover:border-primary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default [&_svg]:size-3.5",
              isSelected &&
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
              <span className="text-[11px] text-muted">{t("emoji.source.users", { count: emoji.users })}</span>
            ) : null}
          </Button>
          </EmojiDragSource>
        );
      })}
    </div>
  );
  const sheetCell = (sheet: EmojiSheet, row: number, column: number): FaceEmoji => ({
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
      ref={viewport}
      data-drag-viewport
      className="emoji-scroll-viewport h-80 min-h-0 overflow-auto p-3 [overflow-anchor:none] sm:h-auto"
    >
      {start > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mb-4"
          disabled={loading}
          onClick={() => void loadPage("previous", anchorScroll)}
        >
          {t("emoji.source.earlier")}
        </Button>
      ) : null}
      {source.kind === "hot" ? (
        <>
          {discovery(items as FaceEmoji[])}
          {!loading && !error && !items.length ? (
            <div className="grid gap-4">
              <p className="text-sm text-muted">{t("emoji.source.noPopular")}</p>
              {defaults.length ? (
                <>
                  <strong className="text-xs text-muted">{t("emoji.source.recommended")}</strong>
                  {discovery(defaults)}
                </>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <FaceSheetGrid
          sheets={items as EmojiSheet[]}
          highlightedBlob={activeBlob}
          disabled={disabled}
          onSelectCell={(sheet, row, column) =>
            onSelect(sheetCell(sheet, row, column))
          }
          renderCell={(sheet, row, column, button) => {
            const emoji = sheetCell(sheet, row, column);
            const key = emojiCellKey(emoji);
            return <EmojiDragSource key={`${row}:${column}`} emoji={emoji} disabled={dragDisabled} lifted={lifted.has(key)} settling={settling.has(`source:${key}`)} onSelect={onSelect}>{button}</EmojiDragSource>;
          }}
          cellState={(sheet, row, column) => {
            const key = emojiCellKey(sheetCell(sheet, row, column));
            return {
              selected: selected?.has(key) ?? activeKey === key,
              collected: owned.has(key),
              highlighted: activeKey === key,
            };
          }}
        />
      )}
      {loading ? (
        <p role="status" className="text-sm text-muted">
          {t("admin.portraits.loading")}
        </p>
      ) : null}
      {source.kind !== "hot" && !loading && !error && !items.length ? (
        <p className="text-sm text-muted">{t("upload.portrait.empty")}</p>
      ) : null}
      {error ? (
        <div role="alert" className="text-sm">
          {error}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => retryPage(anchorScroll)}
          >
            {t("core.action.retry")}
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
          {t("sea.avatar.more")}
        </Button>
      ) : null}
    </div>
  );
});
