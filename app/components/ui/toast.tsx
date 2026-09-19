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
const CONTAINER_ID = "site-feedback";
const disableContainerHotkey = () => false;
const Slide = cssTransition({
  enter: "site-toast-enter",
  exit: "site-toast-exit",
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
      className="site-toast-close"
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
      autoClose: tone === "error" ? 12000 : 5000,
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
          className="site-toast-host"
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
            className="site-toast-list"
            toastClassName="site-toast"
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
