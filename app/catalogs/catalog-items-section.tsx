import { useMessages } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";


import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import * as Dialog from "@/app/components/ui/dialog";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { WorkListItem } from "@/app/components/work/work-list-item";
import { useVisibleWorkItems } from "@/app/components/work/use-visible-work-items";
import type { CatalogDetail, CatalogItem } from "@/lib/dto/db/catalogs";
import { EllipsisVertical } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef, useState } from "react";

type Candidate = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  language: string;
  coverBlobSha256: string | null;
};

export function CatalogItemsSection({
  canEdit,
  catalogId,
  items,
  onSaved,
}: {
  canEdit: boolean;
  catalogId: number;
  items: CatalogItem[];
  onSaved: (catalog: CatalogDetail) => void;
}) {
  const t = useMessages();
  const toast = useToast();
  const visibleItems = useVisibleWorkItems(items);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const editReturnFocusRef = useRef<HTMLElement | null>(null);
  const removeReturnFocusRef = useRef<HTMLElement | null>(null);
  const removalCompletedRef = useRef(false);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [addMessage, setAddMessage] = useState<"empty" | "feedback" | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [invalidSortOrder, setInvalidSortOrder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingRemovalWorkId, setPendingRemovalWorkId] = useState<
    number | null
  >(null);
  const [removingWorkId, setRemovingWorkId] = useState<number | null>(null);
  const selectedItem =
    items.find((item) => item.workId === selectedWorkId) ?? null;
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

      const body = (await requestJson(`/api/works/lookup?scope=catalog&title=${encodeURIComponent(query.trim())}`, { credentials: "same-origin" })) as {
        works?: Candidate[];
        detail?: string;
      };

      const works = (body.works ?? []).filter(
        (work) => !items.some((item) => item.workId === work.id),
      );
      setCandidates(works);
      if (!works.length)
        setAddMessage("empty");
    } catch {
      setAddMessage("feedback");
    } finally {
      setSearching(false);
    }
  }

  async function add(candidate: Candidate) {
    setAdding(true);
    setAddMessage(null);
    try {

      const body = (await requestJson(`/api/catalogs/${catalogId}/items`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId: candidate.id }),
      })) as { ok?: boolean; catalog: CatalogDetail; detail?: string };

      setAddOpen(false);
      toast.success(t("catalog.items.added"));
      onSaved(body.catalog);
    } catch (error) {
      toast.error(error instanceof ApiResponseError ? error : t("relation.edit.network"));
    } finally {
      setAdding(false);
    }
  }

  function openEditor(item: CatalogItem, returnFocus: HTMLElement) {
    editReturnFocusRef.current = returnFocus;
    setSelectedWorkId(item.workId);
    setNote(item.note ?? "");
    setSortOrder(String(item.sortOrder));
    setInvalidSortOrder(false);
  }

  async function saveSelectedItem() {
    if (!selectedItem) return;
    setInvalidSortOrder(false);
    const parsedSortOrder = Number(sortOrder);
    if (
      !sortOrder.trim() ||
      !Number.isSafeInteger(parsedSortOrder) ||
      parsedSortOrder < 0
    ) {
      setInvalidSortOrder(true);
      return;
    }
    setSaving(true);
    try {

      const body = (await requestJson(`/api/catalogs/${catalogId}/items`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workId: selectedItem.workId,
          sortOrder: parsedSortOrder,
          note: note.trim() || null,
        }),
      })) as { ok?: boolean; catalog: CatalogDetail; detail?: string };

      setSelectedWorkId(null);
      toast.success(t("catalog.items.saved"));
      onSaved(body.catalog);
    } catch (error) {
      toast.error(error instanceof ApiResponseError ? error : t("relation.edit.network"));
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(workId: number) {
    setRemovingWorkId(workId);
    try {

      const body = (await requestJson(`/api/catalogs/${catalogId}/items?workId=${workId}`, { method: "DELETE", credentials: "same-origin" })) as { ok?: boolean; catalog: CatalogDetail; detail?: string };

      removalCompletedRef.current = true;
      setPendingRemovalWorkId(null);
      toast.success(t("catalog.items.removed"));
      onSaved(body.catalog);
    } catch (error) {
      toast.error(error instanceof ApiResponseError ? error : t("relation.edit.network"));
    } finally {
      setRemovingWorkId(null);
    }
  }

  return (
    <section aria-labelledby="catalog-games-heading" className="mt-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-baseline gap-3">
          <h2
            className="m-0 font-display text-xl font-bold"
            id="catalog-games-heading"
          >
            {t("catalog.items.heading")}
          </h2>
          <span className="font-mono text-xs text-muted">
            {t("catalog.items.count", { count: items.length })}
          </span>
        </div>
        {canEdit ? (
          <Button
            aria-controls="catalog-add-game-dialog"
            aria-expanded={addOpen}
            aria-haspopup="dialog"
            ref={addButtonRef}
            onClick={() => setAddOpen(true)}
            size="sm"
            type="button"
          >
            {t("catalog.items.add")}
          </Button>
        ) : null}
      </header>
      {items.length ? (
        <ol className="divide-y divide-border border-b border-border">
          {visibleItems.map((item, index) => (
            <WorkListItem
              index={index}
              item={item}
              key={item.workId}
              note={item.note}
              management={
                canEdit ? (
                  <CatalogItemActions
                    disabled={removingWorkId !== null}
                    editing={selectedWorkId === item.workId}
                    item={item}
                    onEdit={(returnFocus) => openEditor(item, returnFocus)}
                    onRemove={(returnFocus) => {
                      removeReturnFocusRef.current = returnFocus;
                      removalCompletedRef.current = false;
                      setPendingRemovalWorkId(item.workId);
                    }}
                    removing={pendingRemovalWorkId === item.workId}
                  />
                ) : null
              }
            />
          ))}
        </ol>
      ) : (
        <div className="mt-4">
          <EmptyState title={t("catalog.items.empty")} />
        </div>
      )}

      <AlertDialog
        open={pendingRemovalItem !== null}
        onOpenChange={(open) => {
          if (!open && removingWorkId === null) setPendingRemovalWorkId(null);
        }}
      >
        <AlertDialogContent
          id="catalog-remove-item-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const returnFocus = removalCompletedRef.current
              ? addButtonRef.current
              : removeReturnFocusRef.current;
            if (returnFocus?.isConnected) returnFocus.focus();
            removalCompletedRef.current = false;
          }}
        >
          <AlertDialogTitle className="m-0 text-lg font-bold">
            {t("favorite.removeNamed", { title: pendingRemovalItem?.title ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription className="m-0 text-sm leading-6 text-muted">
            {t("catalog.items.removeHint")}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                {t("relation.edit.cancel")}
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={removingWorkId !== null || !pendingRemovalItem}
                onClick={() => {
                  if (pendingRemovalItem)
                    void removeItem(pendingRemovalItem.workId);
                }}
                type="button"
                variant="destructive"
              >
                {t("favorite.confirmRemove")}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog.Root open={addOpen} onOpenChange={changeAddOpen}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content
            aria-describedby="catalog-add-game-description"
            className="left-1/2 top-1/2 grid h-[min(85dvh,640px)] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-4 overflow-hidden rounded-lg p-5"
            id="catalog-add-game-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              addButtonRef.current?.focus();
            }}
          >
            <Dialog.Title>{t("catalog.items.add")}</Dialog.Title>
            <Dialog.Description
              className="sr-only"
              id="catalog-add-game-description"
            >
              {t("catalog.items.addHint")}
            </Dialog.Description>
            <form
              className="flex gap-2 max-sm:flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                void lookup();
              }}
            >
              <Input
                aria-label={t("catalog.items.find")}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("catalog.items.query")}
                value={query}
              />
              <Button
                disabled={searching || adding || !query.trim()}
                type="submit"
                variant="outline"
              >
                {searching ? t("relation.edit.searching") : t("catalog.items.search")}
              </Button>
            </form>
            <div className="min-h-0 overflow-y-auto">
              {candidates.length ? (
                <ol
                  aria-label={t("catalog.items.results")}
                  className="divide-y divide-border border-t border-border"
                >
                  {candidates.map((candidate, index) => (
                    <WorkListItem
                      index={index}
                      item={{
                        workId: candidate.id,
                        title:
                          candidate.chineseTitle || candidate.originalTitle,
                        originalTitle: candidate.originalTitle,
                        chineseTitle: candidate.chineseTitle,
                        originalReleaseDate: candidate.originalReleaseDate,
                        engineFamily: candidate.engineFamily,
                        language: candidate.language,
                        coverBlobSha256: candidate.coverBlobSha256,
                      }}
                      key={candidate.id}
                      management={
                        <Button
                          disabled={adding}
                          onClick={() => void add(candidate)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {t("catalog.items.addCandidate")}
                        </Button>
                      }
                    />
                  ))}
                </ol>
              ) : null}
              {addMessage === "empty" ? (
                <EmptyState
                  title={t("catalog.items.cannotFind")}
                  variant="plain"
                  role="status"
                />
              ) : addMessage ? (
                <Notice>{t("relation.edit.network")}</Notice>
              ) : null}
            </div>
            <div className="flex justify-end border-t border-border pt-4">
              <Dialog.Close asChild>
                <Button disabled={adding} type="button" variant="outline">
                  {t("relation.edit.cancel")}
                </Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setSelectedWorkId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content
            aria-describedby="catalog-item-edit-description"
            className="left-1/2 top-1/2 grid max-h-[85dvh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-5"
            id="catalog-edit-item-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (editReturnFocusRef.current?.isConnected)
                editReturnFocusRef.current.focus();
            }}
          >
            <Dialog.Title>{t("catalog.items.edit")}</Dialog.Title>
            <Dialog.Description
              className="sr-only"
              id="catalog-item-edit-description"
            >
              {t("catalog.items.editHint")}
            </Dialog.Description>
            {selectedItem ? (
              <>
                <strong>{selectedItem.title}</strong>
                <FormField controlId="catalog-item-note" label={t("catalog.items.note")}>
                  <Textarea
                    id="catalog-item-note"
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t("catalog.items.notePlaceholder")}
                    rows={4}
                    value={note}
                  />
                </FormField>
                <FormField controlId="catalog-item-sort-order" label={t("catalog.items.sort")}>
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
            {invalidSortOrder ? <Notice>{t("catalog.items.sortInvalid")}</Notice> : null}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Dialog.Close asChild>
                <Button disabled={saving} type="button" variant="outline">
                  {t("relation.edit.cancel")}
                </Button>
              </Dialog.Close>
              <Button
                disabled={saving || !selectedItem}
                onClick={() => void saveSelectedItem()}
                type="button"
              >
                {saving ? t("forum.editor.saving") : t("catalog.items.save")}
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
  editing,
  item,
  onEdit,
  onRemove,
  removing,
}: {
  disabled: boolean;
  editing: boolean;
  item: CatalogItem;
  onEdit: (returnFocus: HTMLElement) => void;
  onRemove: (returnFocus: HTMLElement) => void;
  removing: boolean;
}) {
  const t = useMessages();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuItemClass =
    "flex min-h-9 w-full cursor-pointer data-[disabled]:cursor-not-allowed items-center rounded-sm px-2.5 py-2 text-sm outline-none focus:bg-muted/15 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

  return (
    <>
      <div className="hidden divide-x divide-border overflow-hidden rounded-full border border-border bg-card shadow-sm sm:inline-flex">
        <Button
          aria-controls="catalog-edit-item-dialog"
          aria-expanded={editing}
          aria-haspopup="dialog"
          aria-label={t("catalog.items.editNamed", { title: item.title })}
          className="h-7 min-h-7 rounded-none px-2.5 text-xs shadow-none focus-visible:ring-inset focus-visible:ring-offset-0"
          disabled={disabled}
          onClick={(event) => onEdit(event.currentTarget)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("core.action.edit")}
        </Button>
        <Button
          aria-controls="catalog-remove-item-dialog"
          aria-expanded={removing}
          aria-haspopup="dialog"
          aria-label={t("catalog.items.removeNamed", { title: item.title })}
          className="h-7 min-h-7 rounded-none px-2.5 text-xs text-destructive shadow-none hover:text-destructive focus-visible:ring-inset focus-visible:ring-offset-0"
          disabled={disabled}
          onClick={(event) => onRemove(event.currentTarget)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("core.action.remove")}
        </Button>
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            ref={menuTriggerRef}
            aria-label={t("catalog.items.manageNamed", { title: item.title })}
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
            <DropdownMenu.Item
              aria-controls="catalog-edit-item-dialog"
              aria-haspopup="dialog"
              className={menuItemClass}
              onSelect={() => {
                if (menuTriggerRef.current) onEdit(menuTriggerRef.current);
              }}
            >
              {t("catalog.items.edit")}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              aria-controls="catalog-remove-item-dialog"
              aria-haspopup="dialog"
              className={`${menuItemClass} text-destructive focus:text-destructive`}
              disabled={disabled}
              onSelect={() => {
                if (menuTriggerRef.current) onRemove(menuTriggerRef.current);
              }}
            >
              {t("core.action.remove")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
