import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { preserveFormRedirectLocale, UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
import type {
  ApiConfirmation,
  ApiResponsePayload,
} from "@/lib/ui/api-response";
import { apiConfirmationFromError, requestJson } from "@/lib/ui/api-response";
import type { FormEvent, ReactNode } from "react";
import { useRef, useState } from "react";

type ConfirmingFormProps = {
  action: string;
  children: ReactNode;
  className?: string;
  encType?: "multipart/form-data";
  id?: string;
  method?: "get" | "post";
  confirmField: string;
  errorTitle?: string;
  title: string;
  description: string;
};

export function ConfirmingForm({
  action,
  children,
  className,
  encType,
  id,
  method = "post",
  confirmField,
  errorTitle,
  title,
  description,
}: ConfirmingFormProps) {
  const t = useMessages();
  const navigationLocale = useNavigationLocale();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const submitterRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [retryConfirmation, setRetryConfirmation] =
    useState<ApiConfirmation | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLElement) submitterRef.current = submitter;
    const formData = new FormData(event.currentTarget);
    if (String(formData.get(confirmField) ?? "").trim()) {
      setOpen(true);
      return;
    }
    void submit(event.currentTarget);
  }

  async function submit(
    form: HTMLFormElement | null,
    confirmation: ApiConfirmation | null = null,
  ) {
    if (!form || submittingRef.current) return;
    const submittedFrom = new URL(window.location.href);
    submittingRef.current = true;
    setSubmitting(true);
    setRetryConfirmation(null);
    try {
      const formData = new FormData(form);
      if (confirmation)
        formData.set(confirmation.fieldName, confirmation.fieldValue);
      const request = formRequest(form, formData);
      const requestUrl = new URL(request.url);
      if (navigationLocale && requestUrl.origin === window.location.origin && !requestUrl.searchParams.has(UI_LOCALE_PARAM)) {
        requestUrl.searchParams.set(UI_LOCALE_PARAM, navigationLocale);
      }
      const payload = await requestJson<ApiResponsePayload>(
        requestUrl,
        request.init,
        errorTitle ?? t("core.confirm.failed"),
      );
      const target = new URL(
        payload.redirectTo ?? window.location.href,
        window.location.href,
      );
      if (target.origin !== window.location.origin) {
        throw new Error(
          t("core.confirm.failed"),
        );
      }
      preserveFormRedirectLocale(target, submittedFrom, new URL(window.location.href), navigationLocale);
      setOpen(false);
      setRetryConfirmation(null);
      window.location.assign(target.href);
    } catch (error) {
      submittingRef.current = false;
      setSubmitting(false);
      const nextConfirmation = apiConfirmationFromError(error);
      if (nextConfirmation) {
        setOpen(false);
        setRetryConfirmation(nextConfirmation);
        return;
      }
      toast.error(
        error instanceof Error ? error : errorTitle ?? t("core.confirm.failed"),
      );
    }
  }

  return (
    <>
      <form
        action={action}
        aria-busy={submitting}
        className={className}
        encType={encType}
        id={id}
        method={method}
        onSubmit={handleSubmit}
        ref={formRef}
      >
        <fieldset className="contents" disabled={submitting}>
          {children}
        </fieldset>
      </form>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (submitterRef.current?.isConnected) submitterRef.current.focus();
          }}
        >
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">{t("play.save.cancel")}</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={submitting}
                onClick={() => void submit(formRef.current)}
                variant="destructive"
              >
                {t("core.confirm.continue")}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRetryConfirmation(null);
        }}
        open={Boolean(retryConfirmation)}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (submitterRef.current?.isConnected) submitterRef.current.focus();
          }}
        >
          <AlertDialogTitle>{retryConfirmation?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {retryConfirmation?.description}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">{t("play.save.cancel")}</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={submitting}
                onClick={() => void submit(formRef.current, retryConfirmation)}
                variant="destructive"
              >
                {retryConfirmation?.confirmLabel}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function formRequest(
  form: HTMLFormElement,
  formData: FormData,
): {
  url: string;
  init: RequestInit;
} {
  const method = form.method.toUpperCase();
  if (method === "GET") {
    const url = new URL(form.action);
    for (const [name, value] of formData) {
      if (typeof value === "string") url.searchParams.append(name, value);
    }
    return {
      url: url.href,
      init: {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method,
      },
    };
  }
  return {
    url: form.action,
    init: {
      body: formData,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method,
    },
  };
}
