import { ApiResponseError, requestJson } from "@/lib/ui/api-response";


import { type CoverPickerCandidate, CoverPicker } from "@/app/components/media/media-picker";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import * as Dialog from "@/app/components/ui/dialog";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { CatalogCreateFields } from "./catalog-create-fields";
import type { CatalogDetail } from "@/lib/dto/db/catalogs";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

export function CatalogCreateForm() {
  const createButtonRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) setOpen(nextOpen);
      }}
    >
      <div>
        <Button
          aria-controls="catalog-create-dialog"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={(event) => {
            createButtonRef.current = event.currentTarget;
            setOpen(true);
          }}
          type="button"
        >
          创建目录
        </Button>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="bg-black/55" />
        <Dialog.Content
          aria-describedby="catalog-create-description"
          className="left-1/2 top-1/2 grid w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg p-5"
          id="catalog-create-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (createButtonRef.current?.isConnected)
              createButtonRef.current.focus();
          }}
        >
          <Dialog.Title>创建目录</Dialog.Title>
          <Dialog.Description
            className="sr-only"
            id="catalog-create-description"
          >
            填写目录标题和说明。
          </Dialog.Description>
          <CatalogCreateFields
            busy={busy}
            onBusyChange={setBusy}
            onCancel={() => setOpen(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function CatalogSummaryEditor({
  catalog,
  onSaved,
  canEdit = true,
  canDelete = true,
}: {
  catalog: CatalogDetail;
  onSaved: (catalog: CatalogDetail) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(catalog.title);
  const [description, setDescription] = useState(catalog.description ?? "");
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const coverCandidates = useMemo<CoverPickerCandidate[]>(
    () =>
      catalog.items.flatMap((item) =>
        item.coverBlobSha256
          ? [
              {
                key: `catalog-work-${item.workId}`,
                label: item.title,
                src: `/api/media/blobs/${item.coverBlobSha256}`,
              },
            ]
          : [],
      ),
    [catalog.items],
  );
  function changeOpen(nextOpen: boolean) {
    if (busy) return;
    setOpen(nextOpen);
    if (nextOpen) {
      setTitle(catalog.title);
      setDescription(catalog.description ?? "");
      setCover(null);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("title", title);
      form.set("description", description);
      if (cover) form.set("cover", cover);

      const body = (await requestJson(`/api/catalogs/${catalog.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        body: form,
      })) as { ok?: boolean; catalog: CatalogDetail; detail?: string };

      setOpen(false);
      toast.success("目录资料已保存。");
      onSaved(body.catalog);
    } catch (error) {
      toast.error(error instanceof ApiResponseError ? error.message : "网络请求失败。");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {

      await requestJson(`/api/catalogs/${catalog.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });

      toast.success("目录已删除。");
      navigate("/catalogs");
    } catch (error) {
      toast.error(error instanceof ApiResponseError ? error.message : "网络请求失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm" type="button" variant="outline">
          {canEdit ? "编辑资料" : "管理目录"}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          aria-describedby="catalog-summary-edit-description"
          className="left-1/2 top-1/2 grid max-h-[85dvh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-5"
        >
          <Dialog.Title>编辑目录资料</Dialog.Title>
          <Dialog.Description
            className="sr-only"
            id="catalog-summary-edit-description"
          >
            修改目录封面、标题和说明，或删除目录。
          </Dialog.Description>
          <div className="grid gap-4">
            {canEdit ? (
              <div className="w-full max-w-52">
                <CoverPicker
                  candidates={coverCandidates}
                  currentImageSrc={
                    catalog.coverBlobSha256
                      ? `/api/media/blobs/${catalog.coverBlobSha256}`
                      : null
                  }
                  disabled={busy}
                  existingBlobSha256s={
                    catalog.customCoverBlobSha256
                      ? [catalog.customCoverBlobSha256]
                      : undefined
                  }
                  file={cover}
                  onChange={setCover}
                />
              </div>
            ) : null}
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
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {canDelete ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={busy} type="button" variant="destructive">
                    删除目录
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="z-[60]">
                  <AlertDialogTitle className="m-0 text-lg font-bold">
                    删除这个目录？
                  </AlertDialogTitle>
                  <AlertDialogDescription className="m-0 text-sm leading-6 text-muted">
                    删除后，目录及其中的收录关系将不再公开显示。
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                      <Button type="button" variant="outline">
                        取消
                      </Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button
                        disabled={busy}
                        onClick={() => void remove()}
                        type="button"
                        variant="destructive"
                      >
                        确认删除
                      </Button>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <div className="ml-auto flex gap-2">
              <Dialog.Close asChild>
                <Button disabled={busy} type="button" variant="outline">
                  取消
                </Button>
              </Dialog.Close>
              {canEdit ? (
                <Button
                  disabled={busy || !title.trim()}
                  onClick={() => void save()}
                  type="button"
                >
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
