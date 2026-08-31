"use client";

import { EllipsisVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import { CatalogGameListItem } from "@/app/catalogs/catalog-game-list-item";
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
import { EmptyState } from "@/app/components/ui/empty-state";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { formatNumber } from "@/lib/format";
import type { CatalogItem } from "@/lib/server/db/catalogs";

type Candidate = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
};

export function CatalogItemsSection({
  canEdit,
  catalogId,
  items,
}: {
  canEdit: boolean;
  catalogId: number;
  items: CatalogItem[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingRemovalWorkId, setPendingRemovalWorkId] = useState<number | null>(null);
  const [removingWorkId, setRemovingWorkId] = useState<number | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const selectedItem = items.find((item) => item.workId === selectedWorkId) ?? null;
  const pendingRemovalItem =
    items.find((item) => item.workId === pendingRemovalWorkId) ?? null;

  function changeAddOpen(nextOpen: boolean) {
    if (adding) return;
    setAddOpen(nextOpen);
    if (nextOpen) {
      setQuery("");
      setCandidates([]);
      setAddMessage(null);
    }
  }

  async function lookup() {
    if (!query.trim()) return;
    setSearching(true);
    setAddMessage(null);
    try {
      const response = await fetch(
        `/api/works/lookup?title=${encodeURIComponent(query.trim())}`,
        { credentials: "same-origin" },
      );
      const body = (await response.json()) as {
        works?: Candidate[];
        detail?: string;
      };
      if (!response.ok) {
        setAddMessage(body.detail ?? "查找游戏失败。");
        return;
      }
      const works = (body.works ?? []).filter(
        (work) => !items.some((item) => item.workId === work.id),
      );
      setCandidates(works);
      if (!works.length) setAddMessage("没有找到可添加的游戏。");
    } catch {
      setAddMessage("网络请求失败。");
    } finally {
      setSearching(false);
    }
  }

  async function add(candidate: Candidate) {
    setAdding(true);
    setAddMessage(null);
    try {
      const response = await fetch(`/api/catalogs/${catalogId}/items`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId: candidate.id }),
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setAddMessage(body.detail ?? "游戏添加失败。");
        return;
      }
      setAddOpen(false);
      router.refresh();
    } catch {
      setAddMessage("网络请求失败。");
    } finally {
      setAdding(false);
    }
  }

  function openEditor(item: CatalogItem) {
    setSelectedWorkId(item.workId);
    setNote(item.note ?? "");
    setSortOrder(String(item.sortOrder));
    setEditMessage(null);
  }

  async function saveSelectedItem() {
    if (!selectedItem) return;
    setEditMessage(null);
    const parsedSortOrder = Number(sortOrder);
    if (
      !sortOrder.trim() ||
      !Number.isSafeInteger(parsedSortOrder) ||
      parsedSortOrder < 0
    ) {
      setEditMessage("排序值必须是 0 或正整数。");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/catalogs/${catalogId}/items`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workId: selectedItem.workId,
          sortOrder: parsedSortOrder,
          note: note.trim() || null,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setEditMessage(body.detail ?? "条目保存失败。");
        return;
      }
      setSelectedWorkId(null);
      router.refresh();
    } catch {
      setEditMessage("网络请求失败。");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(workId: number) {
    setRemovingWorkId(workId);
    setListMessage(null);
    try {
      const response = await fetch(
        `/api/catalogs/${catalogId}/items?workId=${workId}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) {
        setListMessage(body.detail ?? "条目移除失败。");
        return;
      }
      setPendingRemovalWorkId(null);
      router.refresh();
    } catch {
      setListMessage("网络请求失败。");
    } finally {
      setRemovingWorkId(null);
    }
  }

  return (
    <section aria-labelledby="catalog-games-heading" className="mt-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-baseline gap-3">
          <h2 className="m-0 font-display text-xl font-bold" id="catalog-games-heading">收录游戏</h2>
          <span className="font-mono text-xs text-muted">共 {formatNumber(items.length)} 个</span>
        </div>
        {canEdit ? (
          <Button onClick={() => setAddOpen(true)} size="sm" type="button">添加游戏</Button>
        ) : null}
      </header>
      {listMessage ? <p className="mb-0 mt-3 text-sm text-red-700" role="status">{listMessage}</p> : null}
      {items.length ? (
        <ol className="divide-y divide-border border-b border-border">
          {items.map((item, index) => (
            <CatalogGameListItem
              index={index}
              item={item}
              key={item.workId}
              management={canEdit ? (
                <CatalogItemActions
                  disabled={removingWorkId !== null}
                  item={item}
                  onEdit={() => openEditor(item)}
                  onRemove={() => setPendingRemovalWorkId(item.workId)}
                />
              ) : null}
            />
          ))}
        </ol>
      ) : (
        <div className="mt-4">
          <EmptyState title="这个目录还没有游戏。" />
        </div>
      )}

      <AlertDialog
        open={pendingRemovalItem !== null}
        onOpenChange={(open) => {
          if (!open && removingWorkId === null) setPendingRemovalWorkId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle className="m-0 text-lg font-bold">
            移除“{pendingRemovalItem?.title}”？
          </AlertDialogTitle>
          <AlertDialogDescription className="m-0 text-sm leading-6 text-muted">
            这只会移除目录中的条目，不会删除游戏。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">取消</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={removingWorkId !== null || !pendingRemovalItem}
                onClick={() => {
                  if (pendingRemovalItem) void removeItem(pendingRemovalItem.workId);
                }}
                type="button"
                variant="destructive"
              >
                确认移除
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog.Root open={addOpen} onOpenChange={changeAddOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content
            aria-describedby="catalog-add-game-description"
            className="fixed left-1/2 top-1/2 z-50 grid max-h-[85dvh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-surface"
          >
            <Dialog.Title className="m-0 text-lg font-bold">添加游戏</Dialog.Title>
            <Dialog.Description className="sr-only" id="catalog-add-game-description">
              搜索并以默认排序值 0 将一个游戏加入目录。
            </Dialog.Description>
            <form className="flex gap-2 max-sm:flex-col" onSubmit={(event) => { event.preventDefault(); void lookup(); }}>
              <Input
                aria-label="查找游戏"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入游戏标题"
                value={query}
              />
              <Button disabled={searching || adding || !query.trim()} type="submit" variant="outline">
                {searching ? "正在查找…" : "查找"}
              </Button>
            </form>
            {candidates.length ? (
              <div aria-label="查找结果" className="flex flex-col gap-2">
                {candidates.map((candidate) => (
                  <Button
                    className="h-auto justify-between whitespace-normal text-left"
                    disabled={adding}
                    key={candidate.id}
                    onClick={() => void add(candidate)}
                    type="button"
                    variant="outline"
                  >
                    <span>{candidate.chineseTitle || candidate.originalTitle}</span>
                    <span className="text-xs text-muted">添加</span>
                  </Button>
                ))}
              </div>
            ) : null}
            {addMessage ? <p className="m-0 text-sm text-muted" role="status">{addMessage}</p> : null}
            <div className="flex justify-end border-t border-border pt-4">
              <Dialog.Close asChild>
                <Button disabled={adding} type="button" variant="outline">取消</Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={selectedItem !== null}
        onOpenChange={(open) => { if (!open && !saving) setSelectedWorkId(null); }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content
            aria-describedby="catalog-item-edit-description"
            className="fixed left-1/2 top-1/2 z-50 grid max-h-[85dvh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-surface"
          >
            <Dialog.Title className="m-0 text-lg font-bold">编辑条目</Dialog.Title>
            <Dialog.Description className="sr-only" id="catalog-item-edit-description">
              修改所选游戏在目录中的备注和排序值。
            </Dialog.Description>
            {selectedItem ? (
              <>
                <strong>{selectedItem.title}</strong>
                <FormField controlId="catalog-item-note" label="目录备注">
                  <Textarea
                    id="catalog-item-note"
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="可选备注"
                    rows={4}
                    value={note}
                  />
                </FormField>
                <FormField
                  controlId="catalog-item-sort-order"
                  hint="0 或正整数；越小越靠前，同值按游戏 ID 倒序。"
                  label="排序值"
                >
                  <Input
                    id="catalog-item-sort-order"
                    inputMode="numeric"
                    max={Number.MAX_SAFE_INTEGER}
                    min={0}
                    onChange={(event) => setSortOrder(event.target.value)}
                    required
                    step={1}
                    type="number"
                    value={sortOrder}
                  />
                </FormField>
              </>
            ) : null}
            {editMessage ? <p className="m-0 text-sm text-red-700" role="status">{editMessage}</p> : null}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Dialog.Close asChild>
                <Button disabled={saving} type="button" variant="outline">取消</Button>
              </Dialog.Close>
              <Button disabled={saving || !selectedItem} onClick={() => void saveSelectedItem()} type="button">
                {saving ? "正在保存…" : "保存条目"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

function CatalogItemActions({
  disabled,
  item,
  onEdit,
  onRemove,
}: {
  disabled: boolean;
  item: CatalogItem;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const menuItemClass =
    "flex min-h-9 w-full cursor-default items-center rounded-sm px-2.5 py-2 text-sm outline-none focus:bg-muted/15 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

  return (
    <>
      <div className="hidden items-center gap-1 sm:flex">
        <Button
          aria-label={`编辑条目：${item.title}`}
          className="h-7 min-h-7 rounded-full px-2.5 text-xs shadow-none"
          disabled={disabled}
          onClick={onEdit}
          size="sm"
          type="button"
          variant="outline"
        >
          编辑
        </Button>
        <Button
          aria-label={`从目录移除：${item.title}`}
          className="h-7 min-h-7 rounded-full px-2.5 text-xs text-destructive shadow-none hover:border-destructive hover:text-destructive"
          disabled={disabled}
          onClick={onRemove}
          size="sm"
          type="button"
          variant="outline"
        >
          移除
        </Button>
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            aria-label={`管理条目：${item.title}`}
            className="size-8 rounded-full sm:hidden"
            disabled={disabled}
            size="icon"
            type="button"
            variant="ghost"
          >
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-36 rounded-md border border-border bg-card p-1 text-foreground shadow-surface"
            sideOffset={6}
          >
            <DropdownMenu.Item className={menuItemClass} onSelect={onEdit}>
              编辑条目
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={`${menuItemClass} text-destructive focus:text-destructive`}
              disabled={disabled}
              onSelect={onRemove}
            >
              移除
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
