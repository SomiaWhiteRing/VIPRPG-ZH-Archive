import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { Button } from "@/app/components/ui/button";
export function EmojiDialog({
  open,
  onOpenChange,
  title,
  children,
  onClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={
            onClose
              ? (event) => {
                  event.preventDefault();
                  onClose();
                }
              : undefined
          }
          className="fixed inset-0 z-[61] flex h-dvh w-full flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-surface sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[90dvh] sm:w-[min(64rem,calc(100vw-1rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2 pt-[max(.5rem,env(safe-area-inset-top))]">
            <Dialog.Title className="font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" aria-label="关闭表情面板">
                关闭
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto p-3 sm:p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
