import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogTitle,
} from "./alert-dialog";
import { Button } from "./button";
import { useToast } from "./toast";

type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  action?: () => Promise<void>;
};
type Confirm = (description: string, options?: ConfirmOptions) => Promise<boolean>;
type Request = ConfirmOptions & {
  description: string;
  resolve: (accepted: boolean) => void;
  returnFocus: HTMLElement | null;
  signal: AbortSignal;
  cancel: () => void;
};
const ConfirmContext = createContext<((description: string, options: ConfirmOptions, signal: AbortSignal) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [request, setRequest] = useState<Request | null>(null);
  const current = useRef<Request | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const focus = useRef<HTMLElement | null>(null);
  const finish = useCallback((accepted: boolean) => {
    const pending = current.current;
    if (!pending) return;
    current.current = null;
    pending.signal.removeEventListener("abort", pending.cancel);
    setRequest(null);
    pending.resolve(accepted);
  }, []);
  const confirm = useCallback((description: string, options: ConfirmOptions, signal: AbortSignal) => {
    // A second click must never replace a confirmation already being answered.
    if (current.current || signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const pending: Request = {
        ...options, description, resolve, signal, cancel: () => finish(false),
        returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      };
      current.current = pending;
      focus.current = pending.returnFocus;
      submitting.current = false;
      setBusy(false);
      setRequest(pending);
      signal.addEventListener("abort", pending.cancel, { once: true });
    });
  }, [finish]);
  useEffect(() => () => {
    const pending = current.current;
    if (pending) {
      pending.signal.removeEventListener("abort", pending.cancel);
      pending.resolve(false);
      current.current = null;
    }
  }, []);

  async function accept() {
    const pending = current.current;
    if (!pending || submitting.current) return;
    if (!pending.action) { finish(true); return; }
    submitting.current = true;
    setBusy(true);
    try {
      await pending.action();
      if (current.current === pending) finish(true);
    } catch (cause) {
      if (current.current === pending) toast.error(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      if (current.current === pending) { submitting.current = false; setBusy(false); }
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!request} onOpenChange={(open) => { if (!open && !submitting.current) finish(false); }}>
        <AlertDialogContent aria-busy={busy}
          onEscapeKeyDown={(event) => { if (submitting.current) event.preventDefault(); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (focus.current?.isConnected) focus.current.focus(); }}>
          <AlertDialogTitle className="text-lg font-bold">{request?.title ?? "确认操作"}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{request?.description}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button type="button" variant="outline" disabled={busy}>取消</Button></AlertDialogCancel>
            <Button type="button" variant={request?.destructive ? "destructive" : "default"} disabled={busy} onClick={() => void accept()}>
              {busy ? "正在处理…" : request?.confirmLabel ?? "继续"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm requires ConfirmProvider");
  const owner = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    owner.current = controller;
    return () => { controller.abort(); };
  }, []);
  return useCallback((description, options = {}) => {
    if (!owner.current || owner.current.signal.aborted) return Promise.resolve(false);
    return confirm(description, options, owner.current.signal);
  }, [confirm]);
}
