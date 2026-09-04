"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
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
import {
  apiConfirmationFromError,
  requestJson,
  type ApiConfirmation,
  type ApiResponsePayload,
} from "@/lib/ui/api-response";

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
  errorTitle = "保存失败",
  title,
  description,
}: ConfirmingFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitterRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryConfirmation, setRetryConfirmation] = useState<ApiConfirmation | null>(null);
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
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    setRetryConfirmation(null);
    try {
      const formData = new FormData(form);
      if (confirmation) formData.set(confirmation.fieldName, confirmation.fieldValue);
      const request = formRequest(form, formData);
      const payload = await requestJson<ApiResponsePayload>(request.url, request.init, errorTitle);
      const target = new URL(payload.redirectTo ?? window.location.href, window.location.href);
      if (target.origin !== window.location.origin) {
        throw new Error(`${errorTitle}：服务器返回了不安全的跳转地址，请刷新页面后重试。`);
      }
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
      setErrorMessage(error instanceof Error ? error.message : `${errorTitle}，请稍后重试。`);
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
        {children}
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
              <Button variant="outline">取消</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button disabled={submitting} onClick={() => void submit(formRef.current)} variant="destructive">
                {submitting ? "提交中…" : "确认继续"}
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
          <AlertDialogDescription>{retryConfirmation?.description}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">取消</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={submitting}
                onClick={() => void submit(formRef.current, retryConfirmation)}
                variant="destructive"
              >
                {submitting ? "提交中…" : retryConfirmation?.confirmLabel}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setErrorMessage(null);
        }}
        open={Boolean(errorMessage)}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (submitterRef.current?.isConnected) submitterRef.current.focus();
          }}
        >
          <AlertDialogTitle>{errorTitle}</AlertDialogTitle>
          <AlertDialogDescription>{errorMessage}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">返回修改</Button>
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function formRequest(form: HTMLFormElement, formData: FormData): {
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
