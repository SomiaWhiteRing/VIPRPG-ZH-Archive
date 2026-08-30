"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import type { CatalogSummary } from "@/lib/server/db/catalogs";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Dialog } from "radix-ui";

export function CatalogCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/catalogs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description: description || null }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        catalog?: CatalogSummary;
        detail?: string;
      };
      if (!response.ok || !body.ok || !body.catalog) {
        setMessage(body.detail ?? "目录创建失败。");
        return;
      }
      router.push(`/catalogs/${body.catalog.id}`);
    } catch {
      setMessage("网络请求失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!busy) setOpen(nextOpen); }}>
      <div><Rm2kButton onClick={() => setOpen(true)} type="button">创建目录</Rm2kButton></div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content
          aria-describedby="catalog-create-description"
          className="fixed left-1/2 top-1/2 z-50 grid w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-5 shadow-surface"
        >
          <Dialog.Title className="m-0 text-lg font-bold">创建目录</Dialog.Title>
          <Dialog.Description className="sr-only" id="catalog-create-description">
            填写目录标题和说明。
          </Dialog.Description>
          <form className="grid gap-4" onSubmit={submit}>
            <FormField label="标题">
              <Input required value={title} onChange={(event) => setTitle(event.target.value)} />
            </FormField>
            <FormField label="说明">
              <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
            </FormField>
            {message ? <p className="m-0 text-sm text-red-700" role="status">{message}</p> : null}
            <div className="flex justify-end gap-2">
              <Rm2kButton disabled={busy} onClick={() => setOpen(false)} type="button">取消</Rm2kButton>
              <Rm2kButton disabled={busy || !title.trim()} type="submit">{busy ? "正在创建…" : "创建目录"}</Rm2kButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function CatalogSummaryEditor({
  catalog,
  canEdit = true,
  canDelete = true,
}: {
  catalog: CatalogSummary;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(catalog.title);
  const [description, setDescription] = useState(catalog.description ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function changeOpen(nextOpen: boolean) {
    if (busy) return;
    setOpen(nextOpen);
    if (nextOpen) {
      setTitle(catalog.title);
      setDescription(catalog.description ?? "");
      setMessage(null);
    }
  }
  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/catalogs/${catalog.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setMessage(body.detail ?? "目录保存失败。");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setMessage("网络请求失败。");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/catalogs/${catalog.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setMessage(body.detail ?? "目录删除失败。");
        return;
      }
      router.push("/catalogs");
    } catch {
      setMessage("网络请求失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm" type="button" variant="outline">{canEdit ? "编辑资料" : "管理目录"}</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content
          aria-describedby="catalog-summary-edit-description"
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[85dvh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-surface"
        >
          <Dialog.Title className="m-0 text-lg font-bold">编辑目录资料</Dialog.Title>
          <Dialog.Description className="sr-only" id="catalog-summary-edit-description">
            修改目录标题和说明，或删除目录。
          </Dialog.Description>
          <div className="grid gap-4">
            <FormField controlId="catalog-title" label="标题">
              <Input
                id="catalog-title"
                readOnly={!canEdit}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FormField>
            <FormField controlId="catalog-description" label="说明">
              <Textarea
                id="catalog-description"
                readOnly={!canEdit}
                rows={5}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
          </div>
          {message ? <p className="m-0 text-sm text-red-700" role="status">{message}</p> : null}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {canDelete ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={busy} type="button" variant="destructive">删除目录</Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="z-[60]">
                  <AlertDialogTitle className="m-0 text-lg font-bold">删除这个目录？</AlertDialogTitle>
                  <AlertDialogDescription className="m-0 text-sm leading-6 text-muted">
                    删除后，目录及其中的收录关系将不再公开显示。
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                      <Button type="button" variant="outline">取消</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button disabled={busy} onClick={() => void remove()} type="button" variant="destructive">
                        确认删除
                      </Button>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <div className="ml-auto flex gap-2">
              <Dialog.Close asChild>
                <Button disabled={busy} type="button" variant="outline">取消</Button>
              </Dialog.Close>
              {canEdit ? (
                <Button disabled={busy || !title.trim()} onClick={() => void save()} type="button">
                  {busy ? "正在保存…" : "保存资料"}
                </Button>
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
