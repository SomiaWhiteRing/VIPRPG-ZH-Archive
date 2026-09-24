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
import { createPortal } from "react-dom";
import { HeightBox } from "@/app/components/ui/height-box";
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
  onMobilePanelOpenChange,
  onClose,
  children,
}: {
  onSelect: (emoji: FaceEmoji, options: { focus: boolean }) => void;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  onMobilePanelOpenChange?: (open: boolean) => void;
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
  const [keyboardHeight, setKeyboardHeight] = useState<number | null>(null);
  const [mobileHost, setMobileHost] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Track the space actually occupied by the mobile panel, including viewport
  // changes, disabled state, library dialogs and picker unmounts.
  const mobileSpacer = useCallback(
    (node: HTMLDivElement | null) => {
      onMobilePanelOpenChange?.(node !== null);
    },
    [onMobilePanelOpenChange],
  );
  const scrollTop = useRef(0);
  const restoreScroll = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollTop = scrollTop.current;
  }, []);
  const request = useRef<AbortController | null>(null);
  const keyboardOpen = useRef(false);
  const panelId = useId();
  const open = mode === "picker" && !disabled;
  const mobileHeight = keyboardHeight
    ? `min(${keyboardHeight}px, 60svh)`
    : "min(20rem, 45svh)";
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
      close();
    }
    // Keep the input toolbar above the replacement keyboard after the native
    // keyboard finishes closing. Fixed reply bars already reserve this space.
    const viewport = window.visualViewport;
    let frame = 0;
    function keepEditorVisible() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const button = trigger.current;
        const keyboard = panel.current;
        if (!button || !keyboard || button.closest('[data-docked="true"]'))
          return;
        const overlap =
          button.getBoundingClientRect().bottom -
          keyboard.getBoundingClientRect().top;
        if (overlap > 0) window.scrollBy({ top: overlap, behavior: "instant" });
      });
    }
    keepEditorVisible();
    viewport?.addEventListener("resize", keepEditorVisible);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", keepEditorVisible);
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
    // Stay inside a modal's focus boundary, but outside editor containers that
    // could turn fixed positioning into a narrow, locally positioned panel.
    setMobileHost(
      trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
    );
    if (!desktop) {
      const viewport = window.visualViewport;
      const height = viewport
        ? window.innerHeight - viewport.height - viewport.offsetTop
        : 0;
      if (height > 120) setKeyboardHeight(height);
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    }
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
      <div className="order-last flex min-h-11 shrink-0 items-center gap-2 border-t border-border bg-card sm:order-first sm:border-b sm:border-t-0 sm:px-2">
        <span className="inline-flex h-11 items-center gap-2 border-b-2 border-primary text-xs text-primary sm:px-2">
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
          {!desktop ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="rounded-none"
              aria-label="返回键盘"
              onClick={() => close(true)}
            >
              <Keyboard />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="管理或添加表情"
            title="管理或添加表情"
            className="rounded-none sm:rounded-md"
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
            className="rounded-none sm:rounded-md"
            onClick={() => close(desktop)}
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
        className="@container/emoji-picker min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/5 sm:h-60 sm:flex-none sm:bg-card sm:p-2"
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
                className="grid h-16 w-auto min-w-0 cursor-pointer place-items-center rounded-none hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait sm:rounded"
                aria-label={`插入${emoji.sources.map((source) => source.name).join("、") || "脸图"}表情`}
                title={
                  emoji.sources.map((source) => source.name).join("、") ||
                  "表情"
                }
                disabled={disabled}
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
        <>
          <HeightBox
            aria-hidden="true"
            ref={mobileSpacer}
            className="shrink-0"
            height={mobileHeight}
          />
          {createPortal(
            <HeightBox
              ref={panel}
              data-mobile-emoji-panel
              id={panelId}
              role="region"
              aria-label="选择表情"
              height={mobileHeight}
              className="fixed inset-x-0 bottom-0 z-[70] flex min-w-0 flex-col overflow-hidden border-t border-border bg-card pb-[env(safe-area-inset-bottom)] text-card-foreground"
            >
              {contents}
            </HeightBox>,
            mobileHost ?? document.body,
          )}
        </>
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
