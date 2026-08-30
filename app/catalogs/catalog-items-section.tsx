"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "radix-ui";
import { CatalogGameListItem } from "@/app/catalogs/catalog-game-list-item";
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
  const [position, setPosition] = useState("1");
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingWorkId, setRemovingWorkId] = useState<number | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const selectedItem = items.find((item) => item.workId === selectedWorkId) ?? null;

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
      const response = await replaceItems([
        ...items.map((item) => ({ workId: item.workId, note: item.note })),
        { workId: candidate.id, note: null },
      ]);
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

  function openEditor(item: CatalogItem, index: number) {
    setSelectedWorkId(item.workId);
    setNote(item.note ?? "");
    setPosition(String(index + 1));
    setEditMessage(null);
  }

  async function saveSelectedItem() {
    if (!selectedItem) return;
    setSaving(true);
    setEditMessage(null);
    try {
      const currentIndex = items.findIndex((item) => item.workId === selectedItem.workId);
      const requestedPosition = Number.parseInt(position, 10);
      const targetIndex = Math.max(
        0,
        Math.min(
          items.length - 1,
          Number.isFinite(requestedPosition) ? requestedPosition - 1 : currentIndex,
        ),
      );
      const ordered = items.filter((item) => item.workId !== selectedItem.workId);
      ordered.splice(targetIndex, 0, {
        ...selectedItem,
        note: note.trim() || null,
      });
      const response = await replaceItems(
        ordered.map((item) => ({ workId: item.workId, note: item.note })),
      );
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
      router.refresh();
    } catch {
      setListMessage("网络请求失败。");
    } finally {
      setRemovingWorkId(null);
    }
  }

  function replaceItems(
    nextItems: Array<{ workId: number; note: string | null }>,
  ): Promise<Response> {
    return fetch(`/api/catalogs/${catalogId}/items`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: nextItems.map((item, index) => ({
          workId: item.workId,
          sortOrder: index,
          note: item.note,
        })),
      }),
    });
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
                <>
                  <Button
                    aria-label={`编辑条目：${item.title}`}
                    onClick={() => openEditor(item, index)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    编辑条目
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        aria-label={`从目录移除：${item.title}`}
                        className="text-destructive hover:text-destructive"
                        disabled={removingWorkId !== null}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        移除
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle className="m-0 text-lg font-bold">移除“{item.title}”？</AlertDialogTitle>
                      <AlertDialogDescription className="m-0 text-sm leading-6 text-muted">
                        这只会移除目录中的条目，不会删除游戏。
                      </AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                          <Button type="button" variant="outline">取消</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button
                            disabled={removingWorkId !== null}
                            onClick={() => void removeItem(item.workId)}
                            type="button"
                            variant="destructive"
                          >
                            确认移除
                          </Button>
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : null}
            />
          ))}
        </ol>
      ) : (
        <div className="mt-4">
          <EmptyState title="这个目录还没有游戏。" />
        </div>
      )}

      <Dialog.Root open={addOpen} onOpenChange={changeAddOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content
            aria-describedby="catalog-add-game-description"
            className="fixed left-1/2 top-1/2 z-50 grid max-h-[85dvh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-surface"
          >
            <Dialog.Title className="m-0 text-lg font-bold">添加游戏</Dialog.Title>
            <Dialog.Description className="sr-only" id="catalog-add-game-description">
              搜索并将一个游戏添加到目录末尾。
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
              修改所选游戏在目录中的备注和位置。
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
                <FormField controlId="catalog-item-position" hint={`1–${items.length}`} label="目录位置">
                  <Input
                    id="catalog-item-position"
                    inputMode="numeric"
                    max={items.length}
                    min={1}
                    onChange={(event) => setPosition(event.target.value)}
                    type="number"
                    value={position}
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
