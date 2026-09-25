import { useToast } from "@/app/components/ui/toast";
import {
  forwardRef,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
} from "react";

type Props = Omit<ComponentPropsWithoutRef<"form">, "action" | "method" | "onSubmit"> & {
  action: string;
  method?: "post";
  onBusyChange?: (busy: boolean) => void;
};

type SubmitControl = HTMLButtonElement | HTMLInputElement;

export const RedirectForm = forwardRef<HTMLFormElement, Props>(function RedirectForm(
  { action, method = "post", onBusyChange, ...props },
  ref,
) {
  const toast = useToast();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;

    const form = event.currentTarget;
    const candidate = (event.nativeEvent as SubmitEvent).submitter;
    const submitter = candidate instanceof HTMLButtonElement || candidate instanceof HTMLInputElement
      ? candidate
      : null;
    const body = submitter ? new FormData(form, submitter) : new FormData(form);
    const controls = Array.from(form.elements)
      .filter((element): element is SubmitControl =>
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        (element.type === "submit" || element.type === "image"),
      )
      .map((control) => ({ control, disabled: control.disabled }));

    busyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    for (const { control } of controls) control.disabled = true;

    try {
      const response = await fetch(form.action, {
        method: form.method,
        body,
        credentials: "same-origin",
        headers: { Accept: "text/html" },
      });

      if (response.redirected) {
        const target = new URL(response.url);
        const error = target.searchParams.get("error");
        if (error) throw new Error(error);
        if (!response.ok) throw new Error("跳转页面暂时无法打开，请稍后重试。");
        navigateTo(target);
        return;
      }

      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as {
            ok?: boolean;
            detail?: string;
            error?: string;
            redirectTo?: string;
          }
        : null;
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.detail || payload?.error || "提交失败，请稍后重试。");
      }
      if (!payload?.redirectTo) {
        throw new Error("服务器没有返回跳转地址，请刷新页面确认操作结果。");
      }
      navigateTo(new URL(payload.redirectTo, window.location.href));
    } catch (error) {
      toast.error(
        error instanceof TypeError
          ? "无法连接服务器，请检查网络后重试。"
          : error instanceof Error
            ? error.message
            : "提交失败，请稍后重试。",
      );
      busyRef.current = false;
      setBusy(false);
      onBusyChange?.(false);
      for (const { control, disabled } of controls) control.disabled = disabled;
    }
  }

  return (
    <form
      {...props}
      action={action}
      aria-busy={busy || undefined}
      method={method}
      onSubmit={(event) => void submit(event)}
      ref={ref}
    />
  );
});

function navigateTo(target: URL) {
  if (target.origin !== window.location.origin) {
    throw new Error("服务器返回了无效的跳转地址，请刷新页面后重试。");
  }
  window.location.assign(target.href);
}
