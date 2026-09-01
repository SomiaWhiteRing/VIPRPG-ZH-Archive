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

type ConfirmingFormProps = {
  action: string;
  children: ReactNode;
  className?: string;
  encType?: "multipart/form-data";
  id?: string;
  method?: "get" | "post";
  confirmField: string;
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
  title,
  description,
}: ConfirmingFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    if (String(formData.get(confirmField) ?? "").trim()) {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <>
      <form action={action} className={className} encType={encType} id={id} method={method} onSubmit={handleSubmit} ref={formRef}>
        {children}
      </form>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">取消</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button onClick={() => formRef.current?.submit()} variant="destructive">
                确认继续
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
