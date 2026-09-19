import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Button } from "@/app/components/ui/button";
import { ReorderItem } from "@/app/components/ui/reorder-item";
import { useToast } from "@/app/components/ui/toast";
import { cn } from "@/lib/ui/cn";
import {
  emojiCellKey,
  type FaceEmoji,
  type EmojiCharacter,
  type EmojiSheet,
} from "@/lib/face-emojis";
import { emojiCells, emojiRequest } from "./client";
import { emojiDragPreview } from "./drag-preview";
import { FaceEmojiImage } from "@/app/components/ui/face-emoji-image";
import { EmojiSourcePicker } from "./source-picker";
import { SourceFaces, sourceKey, type EmojiSource } from "./source-faces";

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "表情操作失败。";
type EmojiDrag = {
  emoji: FaceEmoji;
  from: "source" | "library";
  order: FaceEmoji[];
  slots: { left: number; top: number; width: number; height: number }[];
};
const EMOJI_DRAG_TYPE = "application/x-viprpg-face-emoji";

export function EmojiLibrary({
  admin = false,
  initialCharacter,
  initialSheet,
}: {
  admin?: boolean;
  initialCharacter?: EmojiCharacter;
  initialSheet?: EmojiSheet;
}) {
  const [source, setSource] = useState<EmojiSource>(() =>
    initialCharacter
      ? {
          kind: "character",
          character: initialCharacter,
          focus: initialSheet?.blobSha256,
        }
      : initialSheet
        ? { kind: "sheet", sheet: initialSheet }
        : { kind: "hot" },
  );
  const [mine, setMine] = useState<FaceEmoji[]>([]);
  const [defaults, setDefaults] = useState<FaceEmoji[]>([]);
  const [active, setActive] = useState<FaceEmoji | null>(null);
  const [locateVersion, setLocateVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const toast = useToast();
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [drag, setDrag] = useState<EmojiDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<"source" | "library" | null>(
    null,
  );
  const dragRef = useRef<EmojiDrag | null>(null);
  const dragImage = useRef<HTMLCanvasElement | null>(null);
  const collectionGrid = useRef<HTMLDivElement>(null);
  const collectionViewport = useRef<HTMLDivElement>(null);
  const mutation = useRef(false);
  const workbench = useRef<HTMLDivElement>(null);
  const previewBar = useRef<HTMLDivElement>(null);
  const owned = new Set(mine.map(emojiCellKey));
  const activeKey = active ? emojiCellKey(active) : null;
  const activeIndex = mine.findIndex(
    (emoji) => emojiCellKey(emoji) === activeKey,
  );
  const preview = mine[activeIndex] ?? active;
  const hasPreview = !!preview;
  const character = source.kind === "character" ? source.character : undefined;
  const sourceLabel =
    source.kind === "hot" ? "全站热门" : (character?.name ?? "所选脸图");
  const dragPositions = new Map(
    drag?.order.map((emoji, index) => [emojiCellKey(emoji), index]),
  );

  useEffect(
    () => () => {
      dragImage.current?.remove();
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const result = await emojiRequest<{ emojis: FaceEmoji[] }>(
        admin ? "/api/admin/emojis" : "/api/emojis",
        admin ? undefined : { op: "initialize" },
        controller.signal,
      );
      const recommendations = await emojiRequest<{ emojis: FaceEmoji[] }>(
        "/api/emojis?op=defaults",
        undefined,
        controller.signal,
      );
      setMine(result.emojis);
      setDefaults(recommendations.emojis);
      setReady(true);
      setLoadError("");
    })().catch((error) => {
      if (!controller.signal.aborted) setLoadError(failure(error));
    });
    return () => controller.abort();
  }, [admin, retry]);

  // Reserve the fixed mobile preview's actual height, including safe-area padding.
  useEffect(() => {
    const root = workbench.current,
      bar = previewBar.current;
    if (!hasPreview || !root || !bar) return;
    const measure = () =>
      root.style.setProperty(
        "--emoji-preview-height",
        `${bar.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--emoji-preview-height");
    };
  }, [hasPreview]);

  async function update(action: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(failure(error));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  function select(emoji: FaceEmoji) {
    setActive(
      mine.find((item) => emojiCellKey(item) === emojiCellKey(emoji)) ?? emoji,
    );
  }
  async function changeCollection() {
    if (!preview || busy || !ready) return;
    if (activeIndex >= 0) await remove(preview);
    else await add(preview);
  }
  async function add(emoji: FaceEmoji) {
    if (busy || !ready || !emoji.available || owned.has(emojiCellKey(emoji)))
      return;
    const key = emojiCellKey(emoji);
    if (admin) {
      if (mine.length >= 256) {
        toast.error("默认清单最多保留 256 个表情。");
        return;
      }
      setMine((current) => [...current, emoji]);
      setDirty(true);
      return;
    }
    await update(async () => {
      const result = await emojiRequest<{ emojis: FaceEmoji[] }>(
        "/api/emojis",
        { op: "add", cells: emojiCells([emoji]) },
      );
      setMine(result.emojis);
      const resolved =
        result.emojis.find((item) => emojiCellKey(item) === key) ?? emoji;
      setActive((current) =>
        current && emojiCellKey(current) === key ? resolved : current,
      );
    });
  }
  async function remove(emoji: FaceEmoji) {
    if (busy || !ready) return;
    if (admin) {
      setMine((current) =>
        current.filter((item) => emojiCellKey(item) !== emojiCellKey(emoji)),
      );
      setDirty(true);
      return;
    }
    await update(async () => {
      const result = await emojiRequest<{ emojis: FaceEmoji[] }>(
        "/api/emojis",
        { op: "remove", ids: [emoji.id] },
      );
      setMine(result.emojis);
    });
  }
  function endDrag() {
    dragImage.current?.remove();
    dragImage.current = null;
    dragRef.current = null;
    setDrag(null);
    setDropTarget(null);
  }
  function startDrag(
    emoji: FaceEmoji,
    from: EmojiDrag["from"],
    event: DragEvent<HTMLButtonElement>,
  ) {
    if (
      busy ||
      !ready ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches ||
      (from === "source" &&
        (!emoji.available || owned.has(emojiCellKey(emoji))))
    ) {
      event.preventDefault();
      return;
    }
    const image = emojiDragPreview(emoji, event.currentTarget);
    if (!image) {
      event.preventDefault();
      return;
    }
    dragImage.current?.remove();
    dragImage.current = image;
    event.dataTransfer.setDragImage(image, 24, 24);
    const slots = Array.from(collectionGrid.current?.children ?? []).map(
      (child) => {
        const element = child as HTMLElement;
        return {
          left: element.offsetLeft,
          top: element.offsetTop,
          width: element.offsetWidth,
          height: element.offsetHeight,
        };
      },
    );
    const value = { emoji, from, order: mine, slots };
    dragRef.current = value;
    setDrag(value);
    event.dataTransfer.effectAllowed = from === "source" ? "copy" : "move";
    event.dataTransfer.setData(EMOJI_DRAG_TYPE, emojiCellKey(emoji));
  }
  function dragOver(target: EmojiDrag["from"], event: DragEvent<HTMLElement>) {
    const value = dragRef.current;
    if (!value || busy) return;
    event.preventDefault();
    if (target === "source" && value.from === "source") {
      event.dataTransfer.dropEffect = "none";
      setDropTarget(null);
      return;
    }
    event.dataTransfer.dropEffect = value.from === "source" ? "copy" : "move";
    setDropTarget(target);
    if (target === "library" && value.from === "library") {
      const grid = collectionGrid.current;
      const viewport = collectionViewport.current;
      if (!grid || !viewport || !value.slots.length) return;
      const bounds = viewport.getBoundingClientRect();
      if (event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      if (event.clientY < bounds.top + 24) viewport.scrollTop -= 16;
      else if (event.clientY > bounds.bottom - 24) viewport.scrollTop += 16;
      const gridBounds = grid.getBoundingClientRect();
      const x = event.clientX - gridBounds.left,
        y = event.clientY - gridBounds.top;
      let nearest = 0,
        distance = Infinity;
      for (let index = 0; index < value.slots.length; index++) {
        const slot = value.slots[index];
        const candidate =
          (x - slot.left - slot.width / 2) ** 2 +
          (y - slot.top - slot.height / 2) ** 2;
        if (candidate < distance) {
          distance = candidate;
          nearest = index;
        }
      }
      const current = value.order.findIndex(
        (emoji) => emojiCellKey(emoji) === emojiCellKey(value.emoji),
      );
      if (current === nearest || current < 0) return;
      const order = [...value.order];
      order.splice(nearest, 0, order.splice(current, 1)[0]);
      const next = { ...value, order };
      dragRef.current = next;
      setDrag(next);
    }
  }
  function dragLeave(target: EmojiDrag["from"], event: DragEvent<HTMLElement>) {
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setDropTarget((current) => (current === target ? null : current));
    }
  }
  function drop(target: EmojiDrag["from"], event: DragEvent<HTMLElement>) {
    const value = dragRef.current;
    if (!value) return;
    event.preventDefault();
    endDrag();
    if (busy) return;
    if (target === "library" && value.from === "library") {
      void reorder(value);
      return;
    }
    if (target === value.from) return;
    if (target === "library") void add(value.emoji);
    else void remove(value.emoji);
  }
  async function reorder(value: EmojiDrag) {
    const next = value.order;
    if (
      next.every(
        (emoji, index) => emojiCellKey(emoji) === emojiCellKey(mine[index]),
      )
    )
      return;
    const previous = mine;
    setMine(next);
    if (admin) {
      setDirty(true);
      return;
    }
    const index = next.findIndex((emoji) => emoji.id === value.emoji.id);
    await update(async () => {
      try {
        const result = await emojiRequest<{ emojis: FaceEmoji[] }>(
          "/api/emojis",
          {
            op: "reorder",
            id: value.emoji.id,
            beforeId: next[index + 1]?.id ?? null,
          },
        );
        setMine(result.emojis);
      } catch (error) {
        setMine(previous);
        throw error;
      }
    });
  }
  function locate(emoji: FaceEmoji, preferred?: number) {
    setActive(emoji);
    setLocateVersion((current) => current + 1);
    const related =
      emoji.sources.find((item) => item.id === (preferred ?? character?.id)) ??
      emoji.sources[0];
    if (related) {
      setSource({
        kind: "character",
        character:
          character && related.id === character.id
            ? character
            : { ...related, originalName: related.name },
        focus: emoji.blobSha256,
      });
      if (!emoji.available) toast.info("表情不可用");
    } else if (emoji.available) {
      setSource({
        kind: "sheet",
        sheet: {
          id: 0,
          blobSha256: emoji.blobSha256,
          width: emoji.width,
          height: emoji.height,
        },
      });
    } else toast.info("表情不可用");
  }
  function move(step: number) {
    if (
      activeIndex < 0 ||
      activeIndex + step < 0 ||
      activeIndex + step >= mine.length
    )
      return;
    setMine((current) => {
      const next = [...current];
      [next[activeIndex], next[activeIndex + step]] = [
        next[activeIndex + step],
        next[activeIndex],
      ];
      return next;
    });
    setDirty(true);
  }
  async function replenish() {
    await update(async () => {
      const result = await emojiRequest<{ emojis: FaceEmoji[] }>(
        "/api/emojis",
        { op: "replenish" },
      );
      setMine(result.emojis);
      toast.success("已补充缺少的默认表情。");
    });
  }
  async function save() {
    await update(async () => {
      const result = await emojiRequest<{ emojis: FaceEmoji[] }>(
        "/api/admin/emojis",
        { cells: emojiCells(mine) },
      );
      setMine(result.emojis);
      setDirty(false);
      toast.success("默认表情已保存。");
    });
  }

  return (
    <div
      ref={workbench}
      className={cn(
        "grid min-w-0 gap-3",
        hasPreview && "pb-[var(--emoji-preview-height,144px)] sm:pb-0",
      )}
    >
      <div className="grid min-w-0 overflow-hidden rounded-md border border-border bg-card sm:h-[min(660px,75dvh)] sm:min-h-[440px] sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section
          aria-label="查找脸图"
          onDragOver={(event) => dragOver("source", event)}
          onDragLeave={(event) => dragLeave("source", event)}
          onDrop={(event) => drop("source", event)}
          className={cn(
            "relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] border-b border-border sm:border-b-0 sm:border-r",
            dropTarget === "source" &&
              "bg-primary/5 ring-2 ring-inset ring-primary",
          )}
        >
          <header className="grid gap-2 border-b border-border p-3">
            <EmojiSourcePicker
              character={character}
              label={sourceLabel}
              hot={source.kind === "hot"}
              onHot={() => {
                setSource({ kind: "hot" });
                setActive(null);
              }}
              onSelect={(item) => {
                setSource({ kind: "character", character: item });
                setActive(null);
              }}
            />
          </header>
          <SourceFaces
            key={sourceKey(source)}
            source={source}
            defaults={defaults}
            owned={owned}
            active={active}
            locateVersion={locateVersion}
            disabled={busy || !ready}
            onSelect={select}
            onDragEmoji={(emoji, event) => startDrag(emoji, "source", event)}
            onDragEnd={endDrag}
          />
          {drag?.from === "library" ? (
            <div
              className="pointer-events-none absolute inset-0 grid place-items-center bg-primary/5"
              aria-hidden
            >
              <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-surface">
                <Trash2 />
              </span>
            </div>
          ) : null}
        </section>
        <section
          aria-label={admin ? "默认清单" : "我的表情"}
          onDragOver={(event) => dragOver("library", event)}
          onDragLeave={(event) => dragLeave("library", event)}
          onDrop={(event) => drop("library", event)}
          className={cn(
            "relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]",
            dropTarget === "library" &&
              "bg-primary/5 ring-2 ring-inset ring-primary",
          )}
        >
          <header className="flex min-h-[65px] items-center gap-2 border-b border-border p-3">
            <div className="mr-auto">
              <strong className="text-sm">
                {admin ? "默认清单" : "我的表情"}
              </strong>
              <span className="ml-2 text-xs tabular-nums text-muted">
                {mine.length}
              </span>
            </div>
            {!admin ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={busy || !ready}
                    aria-label="表情库更多操作"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-[75] rounded-md border border-border bg-card p-1 text-sm text-foreground shadow-surface"
                  >
                    <DropdownMenu.Item
                      className="cursor-pointer rounded px-3 py-2 outline-none data-[highlighted]:bg-muted/10"
                      onSelect={() => void replenish()}
                    >
                      补充默认表情
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : null}
          </header>
          <div
            ref={collectionViewport}
            className="h-64 min-h-0 overflow-y-auto p-3 sm:h-auto"
          >
            {loadError ? (
              <div role="alert" className="text-sm">
                {loadError}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRetry((current) => current + 1)}
                >
                  重试
                </Button>
              </div>
            ) : !ready ? (
              <p role="status" className="text-sm text-muted">
                正在加载表情库…
              </p>
            ) : null}
            {ready && !mine.length ? (
              <div className="grid min-h-48 place-content-center gap-2 text-center text-sm text-muted">
                <p className="m-0">还没有表情</p>
              </div>
            ) : null}
            <div
              ref={collectionGrid}
              className="relative flex flex-wrap content-start gap-2"
            >
              {mine.map((emoji, index) => {
                const key = emojiCellKey(emoji);
                const dragging = drag?.from === "library";
                const originalSlot = dragging ? drag.slots[index] : undefined;
                const targetSlot = dragging
                  ? drag.slots[dragPositions.get(key) ?? index]
                  : undefined;
                return (
                  <ReorderItem
                    key={key}
                    className={cn(
                      "group relative size-14",
                      dragging &&
                        "transition-transform duration-150 ease-out motion-reduce:transition-none",
                      dragging &&
                        emojiCellKey(drag.emoji) === key &&
                        "opacity-25",
                    )}
                    offset={
                      originalSlot && targetSlot
                        ? {
                            x: targetSlot.left - originalSlot.left,
                            y: targetSlot.top - originalSlot.top,
                          }
                        : undefined
                    }
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      aria-label={`定位${emoji.sources[0]?.name ?? "表情"}的来源脸图`}
                      aria-pressed={activeKey === key}
                      disabled={busy}
                      draggable={!busy}
                      onDragStart={(event) =>
                        startDrag(emoji, "library", event)
                      }
                      onDragEnd={endDrag}
                      className={cn(
                        "relative inline-flex size-14 cursor-pointer items-center justify-center rounded border border-transparent hover:border-primary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default",
                        activeKey === key &&
                          "border-primary bg-primary/5 ring-1 ring-primary",
                      )}
                      onClick={() => locate(emoji)}
                    >
                      <FaceEmojiImage emoji={emoji} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      aria-label={
                        admin ? "从默认清单移除表情" : "从表情库移除表情"
                      }
                      title="移除表情"
                      disabled={busy}
                      onClick={() => void remove(emoji)}
                      className={cn(
                        "absolute -right-0.5 -top-0.5 z-10 hidden size-4 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:inline-flex [&_svg]:size-2.5",
                        drag && "invisible",
                      )}
                    >
                      <X aria-hidden size={10} />
                    </Button>
                  </ReorderItem>
                );
              })}
            </div>
          </div>
          <footer>
            {preview ? (
              <div
                ref={previewBar}
                aria-label="表情预览"
                className="fixed inset-x-0 bottom-0 z-[65] grid gap-2 border-t border-border bg-card p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] text-card-foreground shadow-surface sm:static sm:z-auto sm:pb-3 sm:shadow-none"
              >
                <div className="flex items-center gap-3">
                  <FaceEmojiImage emoji={preview} size={96} />
                  <div className="grid min-w-0 flex-1 gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={activeIndex >= 0 ? "outline" : "default"}
                        disabled={
                          busy ||
                          !ready ||
                          (activeIndex < 0 && !preview.available)
                        }
                        onClick={() => void changeCollection()}
                      >
                        {activeIndex >= 0 ? (
                          <Trash2 aria-hidden />
                        ) : (
                          <Plus aria-hidden />
                        )}
                        {activeIndex >= 0
                          ? admin
                            ? "从默认清单移除"
                            : "从表情库移除"
                          : admin
                            ? "加入默认清单"
                            : "加入我的表情"}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="ml-auto shrink-0"
                        aria-label="关闭表情预览"
                        onClick={() => {
                          setActive(null);
                        }}
                      >
                        <X />
                      </Button>
                    </div>
                    {preview.sources.length ? (
                      <div
                        className="flex max-h-14 flex-wrap gap-1 overflow-y-auto"
                        aria-label="相关角色"
                      >
                        {preview.sources.map((item) => (
                          <Button
                            variant="ghost"
                            size="sm"
                            key={item.id}
                            type="button"
                            className={cn(
                              "min-h-0 cursor-pointer rounded px-1.5 py-1 text-xs font-normal hover:bg-muted/10",
                              item.id === character?.id
                                ? "bg-primary/10 text-primary"
                                : "text-muted",
                            )}
                            onClick={() => locate(preview, item.id)}
                          >
                            {item.name}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <p className="m-0 text-xs text-muted">
                        {preview.available ? "暂无关联角色" : "表情不可用"}
                      </p>
                    )}
                    {admin && activeIndex >= 0 ? (
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={busy || activeIndex === 0}
                          aria-label="表情前移"
                          onClick={() => move(-1)}
                        >
                          <ArrowLeft />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={busy || activeIndex === mine.length - 1}
                          aria-label="表情后移"
                          onClick={() => move(1)}
                        >
                          <ArrowRight />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {admin ? (
              <div className="flex items-center justify-end gap-2 border-t border-border p-3">
                <span className="mr-auto text-xs text-muted">
                  {dirty ? "尚未保存" : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !ready || !dirty}
                  onClick={() => void save()}
                >
                  保存默认表情
                </Button>
              </div>
            ) : null}
          </footer>
          {drag?.from === "source" ? (
            <div
              className="pointer-events-none absolute inset-0 grid place-items-center bg-primary/5"
              aria-hidden
            >
              <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-surface">
                <Plus />
              </span>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
