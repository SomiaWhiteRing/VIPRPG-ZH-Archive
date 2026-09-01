"use client";

import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { SelectField } from "@/app/components/ui/select";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import type { CatalogSummary } from "@/lib/server/db/catalogs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "radix-ui";

export function WorkEngagementActions({
  currentUserId,
  initialFavorited,
  workId,
}: {
  currentUserId: number | null;
  initialFavorited: boolean;
  workId: number;
}) {
  return (
    <WorkFavoriteButton
      currentUserId={currentUserId}
      initialFavorited={initialFavorited}
      workId={workId}
    />
  );
}

export function CatalogAddDialog({
  catalogs,
  workId,
}: {
  catalogs: CatalogSummary[];
  workId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [catalogId, setCatalogId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function changeOpen(nextOpen: boolean) {
    if (busy) return;
    setOpen(nextOpen);
    if (nextOpen) setMessage(null);
  }

  async function addToCatalog() {
    if (!catalogId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/catalogs/${catalogId}/items`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId }),
      });
      if (!response.ok) {
        setMessage("添加到目录失败，请稍后重试。");
        return;
      }
      setMessage("已添加到目录。");
      router.refresh();
    } catch {
      setMessage("网络请求失败，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button
          className="min-w-0 flex-1 shrink px-1 text-[#1f6f67] hover:bg-transparent hover:underline"
          size="sm"
          type="button"
          variant="ghost"
        >
          添加到目录
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content
          aria-describedby="catalog-add-work-description"
          className="fixed left-1/2 top-1/2 z-50 grid w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-5 shadow-surface"
        >
          <Dialog.Title className="m-0 text-lg font-bold">
            添加到目录
          </Dialog.Title>
          <Dialog.Description
            className="sr-only"
            id="catalog-add-work-description"
          >
            选择一个目录，将当前游戏添加到其中。
          </Dialog.Description>
          {catalogs.length ? (
            <>
              <FormField label="目录">
                <SelectField
                  disabled={busy}
                  onValueChange={setCatalogId}
                  options={catalogs.map((catalog) => ({
                    value: String(catalog.id),
                    label: catalog.title,
                  }))}
                  placeholder="选择目录"
                  value={catalogId}
                />
              </FormField>
              {message ? (
                <p className="m-0 text-sm text-muted" role="status">
                  {message}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Dialog.Close asChild>
                  <Button disabled={busy} type="button" variant="outline">
                    关闭
                  </Button>
                </Dialog.Close>
                <Button
                  disabled={busy || !catalogId}
                  onClick={() => void addToCatalog()}
                  type="button"
                >
                  {busy ? "正在添加…" : "添加"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="m-0 text-sm text-muted">你还没有可用的目录。</p>
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    关闭
                  </Button>
                </Dialog.Close>
                <Button asChild>
                  <Link href="/me/catalogs">管理我的目录</Link>
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
