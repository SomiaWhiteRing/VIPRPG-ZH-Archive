import { CircleCheck, CircleAlert, Info, X } from "lucide-react";
import { Portal } from "radix-ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  ToastContainer,
  cssTransition,
  toast as notify,
  type CloseButtonProps,
  type IconProps,
} from "react-toastify/unstyled";
import { Button } from "./button";

type ToastTone = "success" | "error" | "info";
type ToastApi = Record<ToastTone, (message: string) => void>;

const ToastContext = createContext<ToastApi | null>(null);
// Keep Toastify's progress animation as the single auto-close clock.
const toastClassName = [
  "w-full flex-none items-start min-h-18 mb-2 pt-3.5 pr-12 pb-5.5 pl-3.5 border-0 rounded-lg shadow-[inset_0_0_0_1px_var(--color-border),var(--shadow-surface)] text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere] pointer-events-auto",
  String.raw`[&_.Toastify\_\_toast-icon]:w-5 [&_.Toastify\_\_toast-icon]:mt-0.5 [&_.Toastify\_\_toast-icon]:me-3 [&_.Toastify\_\_toast-icon]:text-(--toastify-color-info)`,
  String.raw`[&.Toastify\_\_toast--success_.Toastify\_\_toast-icon]:text-(--toastify-color-success) [&.Toastify\_\_toast--error_.Toastify\_\_toast-icon]:text-(--toastify-color-error)`,
  String.raw`[&_.Toastify\_\_progress-bar--wrp]:[inset:auto_0.875rem_0.5rem] [&_.Toastify\_\_progress-bar--wrp]:w-auto [&_.Toastify\_\_progress-bar--wrp]:h-1 [&_.Toastify\_\_progress-bar--wrp]:border [&_.Toastify\_\_progress-bar--wrp]:border-border [&_.Toastify\_\_progress-bar--wrp]:rounded-[2px]`,
  String.raw`[&_.Toastify\_\_progress-bar--bg]:opacity-0 [&_.Toastify\_\_progress-bar]:rounded-none [&_.Toastify\_\_progress-bar--animated]:animate-site-toast-countdown`,
  String.raw`focus-within:[&_.Toastify\_\_progress-bar]:[animation-play-state:paused]! [&[data-in=false]_.Toastify\_\_progress-bar]:[animation-play-state:paused]! data-[in=false]:pointer-events-none motion-reduce:duration-[1ms]!`,
].join(" ");

const CONTAINER_ID = "site-feedback";
const disableContainerHotkey = () => false;
const Slide = cssTransition({
  enter: "animate-site-toast-enter motion-reduce:animate-site-toast-reduced-motion",
  exit: "animate-site-toast-exit motion-reduce:animate-site-toast-reduced-motion",
  collapse: true,
  collapseDuration: 220,
});

function ToastIcon({ type }: IconProps) {
  const Icon =
    type === "error" ? CircleAlert : type === "success" ? CircleCheck : Info;
  return <Icon aria-hidden size={20} />;
}

function ToastClose({ closeToast }: CloseButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute top-2.5 right-2 size-8"
      aria-label="关闭通知"
      title="关闭通知"
      onClick={closeToast}
    >
      <X aria-hidden />
    </Button>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  useEffect(() => {
    function focusNotification(event: KeyboardEvent) {
      if (!event.altKey || event.code !== "KeyT") return;
      const first = host.current?.querySelector<HTMLElement>(
        ".Toastify__toast[data-in='true']",
      );
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
    // CSS pauses only the focused notification. The library shortcut pauses
    // every toast until Escape, even after focus has left the notification area.
    document.addEventListener("keydown", focusNotification);
    return () => document.removeEventListener("keydown", focusNotification);
  }, []);
  // Include queued notifications: Toastify's isActive only covers visible ones.
  const messages = useRef(new Set<string>());
  const show = useCallback((tone: ToastTone, message: string) => {
    const text = message.trim();
    if (!text) return;
    const key = JSON.stringify([tone, text]);
    if (messages.current.has(key)) return;
    messages.current.add(key);
    notify(text, {
      containerId: CONTAINER_ID,
      toastId: ++sequence.current,
      type: tone,
      autoClose: tone === "success" ? 2000 : 4000,
      role: tone === "error" ? "alert" : "status",
      onClose: () => messages.current.delete(key),
    });
  }, []);
  const toast = useMemo<ToastApi>(
    () => ({
      success: (message) => show("success", message),
      error: (message) => show("error", message),
      info: (message) => show("info", message),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <Portal.Root asChild>
        <div
          ref={host}
          className="[--toastify-color-light:var(--color-card)] [--toastify-text-color-light:var(--color-card-foreground)] [--toastify-color-info:#0369a1] [--toastify-color-success:#047857] [--toastify-color-error:var(--color-destructive)] [--toastify-color-progress-info:var(--toastify-color-info)] [--toastify-color-progress-success:var(--toastify-color-success)] [--toastify-color-progress-error:var(--toastify-color-error)] [--toastify-font-family:var(--font-sans)] [--toastify-z-index:2000]"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            const current = (event.target as HTMLElement).closest<HTMLElement>(
              ".Toastify__toast[data-in='true']",
            );
            if (current) {
              event.stopPropagation();
              notify.dismiss({
                id: Number(current.id),
                containerId: CONTAINER_ID,
              });
            }
          }}
        >
          <ToastContainer
            containerId={CONTAINER_ID}
            position="top-right"
            className="top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] left-auto w-[min(24.5rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top))] overflow-x-hidden overflow-y-auto p-1 [scrollbar-width:thin] pointer-events-none"
            toastClassName={toastClassName}
            transition={Slide}
            limit={3}
            newestOnTop={false}
            pauseOnHover
            pauseOnFocusLoss
            closeOnClick={false}
            draggable="touch"
            closeButton={ToastClose}
            icon={ToastIcon}
            hotKeys={disableContainerHotkey}
            aria-label="通知（Alt+T 聚焦，Escape 关闭）"
          />
        </div>
      </Portal.Root>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast requires ToastProvider");
  return toast;
}
