import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Popover } from "radix-ui";
import { Link } from "react-router";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import type { FaceEmoji } from "@/lib/face-emojis";
import { FaceEmojiImage } from "@/app/components/ui/face-emoji-image";
import { emojiCells, emojiRequest } from "./client";

export function FaceEmojiView({
  emoji,
  allowCollect = true,
}: {
  emoji: FaceEmoji | null;
  allowCollect?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [addedId, setAddedId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const activation = useRef<"hover" | "pointer" | "keyboard">("pointer");
  const timers = useRef<{
    open?: ReturnType<typeof setTimeout>;
    close?: ReturnType<typeof setTimeout>;
  }>({});
  const collecting = useRef(false);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      clearTimeout(pending.open);
      clearTimeout(pending.close);
    };
  }, []);
  function clearTimers() {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
  }
  function changeOpen(value: boolean) {
    clearTimers();
    setOpen(value);
  }
  function closeAfterHover() {
    clearTimers();
    if (activation.current !== "hover") return;
    timers.current.close = setTimeout(() => {
      if (!content.current?.contains(document.activeElement)) setOpen(false);
    }, 200);
  }
  if (!emoji?.available)
    return (
      <span className="mx-0.5 inline-flex align-bottom">
        <FaceEmojiImage emoji={emoji} size={48} />
      </span>
    );
  const added = addedId === emoji.id;
  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          ref={trigger}
          type="button"
          className="mx-0.5 inline-flex size-12 cursor-pointer rounded-none align-bottom focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={allowCollect ? "查看并收藏表情" : "查看表情"}
          onPointerEnter={(event) => {
            if (
              event.pointerType !== "mouse" ||
              !window.matchMedia("(hover: hover)").matches
            )
              return;
            clearTimers();
            if (open) return;
            timers.current.open = setTimeout(() => {
              activation.current = "hover";
              setOpen(true);
            }, 150);
          }}
          onPointerLeave={closeAfterHover}
          onPointerDown={() => {
            clearTimers();
            activation.current = "pointer";
          }}
          onKeyDown={() => {
            clearTimers();
            activation.current = "keyboard";
          }}
        >
          <FaceEmojiImage emoji={emoji} size={48} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={content}
          side="top"
          sideOffset={6}
          collisionPadding={12}
          aria-label="表情预览"
          onPointerEnter={clearTimers}
          onPointerLeave={closeAfterHover}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget) &&
              !event.currentTarget.matches(":hover") &&
              !trigger.current?.matches(":hover")
            )
              closeAfterHover();
          }}
          onOpenAutoFocus={(event) => {
            if (activation.current !== "keyboard") event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (activation.current !== "keyboard") event.preventDefault();
          }}
          className="z-[70] grid w-44 max-w-[calc(100vw-1.5rem)] justify-items-center gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-surface"
        >
          {emoji.sources.length ? (
            <div
              className="flex max-h-20 w-full flex-wrap justify-center gap-x-2 gap-y-1 overflow-y-auto text-center text-sm leading-5 text-muted"
              aria-label="相关角色"
            >
              {emoji.sources.map((source) => (
                <Link
                  key={source.id}
                  className="min-w-0 [overflow-wrap:anywhere] hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                  to={`/characters/${source.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.name}
                </Link>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted">暂无关联角色</span>
          )}
          <FaceEmojiImage emoji={emoji} size={96} />
          {allowCollect ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full border-primary text-primary hover:bg-primary/5"
              disabled={busy || added}
              onClick={async () => {
                if (collecting.current) return;
                collecting.current = true;
                setBusy(true);
                try {
                  await emojiRequest("/api/emojis", {
                    op: "add",
                    cells: emojiCells([emoji]),
                  });
                  setAddedId(emoji.id);
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "收藏失败。",
                  );
                } finally {
                  collecting.current = false;
                  setBusy(false);
                }
              }}
            >
              {added ? <Check aria-hidden /> : <Plus aria-hidden />}
              {added ? "已加入表情库" : busy ? "正在加入…" : "加入表情库"}
            </Button>
          ) : null}
          <Popover.Arrow width={12} height={6} className="fill-card" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
