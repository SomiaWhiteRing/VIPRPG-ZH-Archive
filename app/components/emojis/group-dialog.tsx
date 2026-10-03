import type { ReactNode } from "react";
import * as Dialog from "@/app/components/ui/dialog";
import { X } from "lucide-react";
import { Button } from "@/app/components/ui/button";

export function EmojiGroupDialog({ open, onOpenChange, title, children, busy = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  busy?: boolean;
}) {
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="z-[80] bg-black/40" />
      <Dialog.Content aria-describedby={undefined} className="emoji-scroll-viewport left-1/2 top-1/2 z-[81] grid max-h-[85dvh] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-3 overflow-y-auto rounded-lg p-4">
        <div className="flex items-center gap-2"><Dialog.Title className="mr-auto text-sm font-semibold">{title}</Dialog.Title>
          <Dialog.Close asChild><Button type="button" size="icon" variant="ghost" disabled={busy} aria-label="关闭分组弹窗"><X aria-hidden /></Button></Dialog.Close>
        </div>{children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
