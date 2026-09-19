import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  Keyboard,
  LoaderCircle,
  Plus,
  Smile,
  X,
} from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/app/components/ui/button";
import type { FaceEmoji } from "@/lib/face-emojis";
import { cn } from "@/lib/ui/cn";
import { emojiRequest } from "./client";
import { EmojiDialog } from "./dialog";
import { EmojiLibrary } from "./library";
import { FaceEmojiImage } from "@/app/components/ui/face-emoji-image";

const desktopQuery = "(min-width: 640px)";
function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const getDesktop = () => window.matchMedia(desktopQuery).matches;
const getServerDesktop = () => false;
type Mode = "closed" | "picker" | "manage";

export function EmojiPicker({
  onSelect,
  disabled,
  onOpenChange,
  onClose,
  children,
}: {
  onSelect: (emoji: FaceEmoji, options: { focus: boolean }) => void;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  children: (trigger: ReactNode) => ReactNode;
}) {
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    getDesktop,
    getServerDesktop,
  );
  const [mode, setMode] = useState<Mode>("closed");
  const [emojis, setEmojis] = useState<FaceEmoji[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const restoreScroll = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollTop = scrollTop.current;
  }, []);
  const request = useRef<AbortController | null>(null);
  const keyboardOpen = useRef(false);
  const panelId = useId();
  const open = mode === "picker" && !disabled;
  const available = emojis.filter((emoji) => emoji.available);
  const changeMode = useCallback(
    (next: Mode) => {
      setMode(next);
      onOpenChange?.(next !== "closed");
    },
    [onOpenChange],
  );
  const close = useCallback(
    (restoreFocus = false) => {
      changeMode("closed");
      if (restoreFocus) onClose?.();
    },
    [changeMode, onClose],
  );

  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!open || desktop) return;
    function outside(event: Event) {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    const frame = requestAnimationFrame(() =>
      panel.current?.scrollIntoView({ block: "nearest" }),
    );
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open, desktop, close]);

  async function refresh() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await emojiRequest<{ emojis: FaceEmoji[] }>(
        "/api/emojis",
        { op: "initialize" },
        controller.signal,
      );
      if (!controller.signal.aborted) setEmojis(result.emojis);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : "表情加载失败。");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function showPicker() {
    if (!desktop && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    changeMode("picker");
    void refresh();
  }
  const button = (
    <Button
      ref={trigger}
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label={open && !desktop ? "返回键盘" : "表情"}
      title={open && !desktop ? "返回键盘" : "表情"}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      className={cn(open && "text-primary")}
      onPointerDown={(event) => {
        keyboardOpen.current = false;
        event.preventDefault();
      }}
      onKeyDown={() => {
        keyboardOpen.current = true;
      }}
      onClick={desktop ? undefined : () => (open ? close(true) : showPicker())}
    >
      {open && !desktop ? <Keyboard aria-hidden /> : <Smile aria-hidden />}
    </Button>
  );
  const contents = (
    <>
      <div className="order-last flex min-h-11 shrink-0 items-center gap-2 border-t border-border bg-card px-2 sm:order-first sm:border-b sm:border-t-0">
        <span className="inline-flex h-11 items-center gap-2 border-b-2 border-primary px-2 text-xs text-primary">
          <Smile size={18} aria-hidden />
          我的表情
        </span>
        {loading ? (
          <LoaderCircle
            size={14}
            className="animate-spin text-muted motion-reduce:animate-none"
            aria-label="正在加载"
          />
        ) : null}
        <div className="ml-auto flex items-center">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="管理或添加表情"
            title="管理或添加表情"
            onClick={() => changeMode("manage")}
          >
            <Plus />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="收起表情"
            title="收起表情"
            onClick={() => close(true)}
          >
            {desktop ? <X /> : <ChevronDown />}
          </Button>
        </div>
      </div>
      <div
        ref={restoreScroll}
        onScroll={(event) => {
          scrollTop.current = event.currentTarget.scrollTop;
        }}
        className="@container/emoji-picker h-[min(17rem,38dvh)] min-h-0 overflow-y-auto overscroll-contain bg-muted/5 p-2 sm:h-60 sm:bg-card"
      >
        {error ? (
          <div role="alert" className="p-2 text-sm">
            {error}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
            >
              重试
            </Button>
          </div>
        ) : null}
        {!available.length ? (
          <p
            role="status"
            className="m-0 grid h-full place-items-center text-sm text-muted"
          >
            {loading ? "正在加载…" : error ? "" : "暂无可用表情"}
          </p>
        ) : (
          <div className="grid grid-cols-4 content-start gap-y-1 @min-[240px]/emoji-picker:grid-cols-5 sm:grid-cols-5">
            {available.map((emoji) => (
              <Button
                variant="ghost"
                size="icon"
                key={emoji.id}
                type="button"
                className="grid h-16 w-auto min-w-0 cursor-pointer place-items-center rounded hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait"
                aria-label={`插入${emoji.sources.map((source) => source.name).join("、") || "脸图"}表情`}
                title={
                  emoji.sources.map((source) => source.name).join("、") ||
                  "表情"
                }
                disabled={disabled || loading}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (desktop) changeMode("closed");
                  onSelect(emoji, { focus: desktop });
                }}
              >
                <FaceEmojiImage emoji={emoji} />
              </Button>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <Popover.Root
        open={desktop && open}
        onOpenChange={(value) => (value ? showPicker() : close())}
      >
        {children(
          desktop ? (
            <Popover.Trigger asChild>{button}</Popover.Trigger>
          ) : (
            button
          ),
        )}
        {desktop ? (
          <Popover.Portal>
            <Popover.Content
              ref={panel}
              id={panelId}
              side="bottom"
              align="start"
              sideOffset={6}
              collisionPadding={12}
              aria-label="选择表情"
              onOpenAutoFocus={(event) => {
                if (!keyboardOpen.current) event.preventDefault();
              }}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onEscapeKeyDown={() => onClose?.()}
              className="z-[70] flex w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-surface"
            >
              {contents}
            </Popover.Content>
          </Popover.Portal>
        ) : null}
      </Popover.Root>
      {open && !desktop ? (
        <div
          ref={panel}
          id={panelId}
          role="region"
          aria-label="选择表情"
          className="flex min-w-0 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card pb-[env(safe-area-inset-bottom)] text-card-foreground"
        >
          {contents}
        </div>
      ) : null}
      <EmojiDialog
        open={mode === "manage"}
        onOpenChange={(value) => {
          if (!value) showPicker();
        }}
        title="表情库"
        onClose={() => trigger.current?.focus({ preventScroll: true })}
      >
        <EmojiLibrary />
      </EmojiDialog>
    </>
  );
}
