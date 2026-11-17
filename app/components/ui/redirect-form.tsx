import { ApiResponseError, apiResponseError, requestResponse, readJsonResponse, type ApiResponsePayload } from "@/lib/ui/api-response";
import { useToast } from "@/app/components/ui/toast";
import { UiFeedbackError } from "@/lib/i18n/feedback";
import { preserveFormRedirectLocale, UI_LOCALE_PARAM, type UiLocale } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
import { createPath, parsePath } from "react-router";
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
  preserveLanguage?: boolean;
  responseType?: "html" | "json";
  onBusyChange?: (busy: boolean) => void;
};

type SubmitControl = HTMLButtonElement | HTMLInputElement;

export const RedirectForm = forwardRef<HTMLFormElement, Props>(function RedirectForm(
  { action, method = "post", onBusyChange, preserveLanguage, responseType = "html", ...props },
  ref,
) {
  const toast = useToast();
  const t = useMessages();
  const locale = useNavigationLocale();
  if (preserveLanguage && locale) {
    const path = parsePath(action);
    const params = new URLSearchParams(path.search);
    if (!params.has(UI_LOCALE_PARAM)) {
      params.set(UI_LOCALE_PARAM, locale);
      action = createPath({ ...path, search: params.toString() });
    }
  }
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;

    const form = event.currentTarget;
    const submittedFrom = new URL(window.location.href);
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
      const response = await requestResponse(form.action, {
        method: form.method,
        body,
        credentials: "same-origin",
        headers: { Accept: responseType === "json" ? "application/json" : "text/html" },
      });

      if (response.redirected) {
        const target = new URL(response.url);
        const error = target.searchParams.get("error");
        if (error) throw new Error(error);
        if (!response.ok) throw new UiFeedbackError("core.form.unavailable");
        navigateTo(target, submittedFrom, preserveLanguage ? locale : undefined);
        return;
      }

      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await readJsonResponse<ApiResponsePayload>(response, t("core.form.failed"), true)
        : null;
      if (!response.ok || payload?.ok === false) {
        throw apiResponseError(response.status, payload ?? {}, t("core.form.failed"));
      }
      if (!payload?.redirectTo) {
        throw new UiFeedbackError("core.form.missing");
      }
      navigateTo(new URL(payload.redirectTo, window.location.href), submittedFrom, preserveLanguage ? locale : undefined);
    } catch (error) {
      if (error instanceof TypeError || (error instanceof ApiResponseError && error.code === "network_error")) {
        toast.error(t("core.form.network"));
      } else if (error instanceof ApiResponseError && error.code === "invalid_response") {
        toast.error(t("core.form.badResponse"));
      } else {
        toast.error(error instanceof Error ? error : t("core.form.retry"));
      }
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

function navigateTo(target: URL, submittedFrom: URL, locale?: UiLocale | null) {
  if (target.origin !== window.location.origin) {
    throw new UiFeedbackError("core.form.invalid");
  }
  if (locale !== undefined) {
    preserveFormRedirectLocale(target, submittedFrom, new URL(window.location.href), locale);
  }
  window.location.assign(target.href);
}
