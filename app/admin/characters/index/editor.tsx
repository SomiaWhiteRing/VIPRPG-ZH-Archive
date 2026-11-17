import { CharacterMembershipPicker, CharacterNameFields } from "./character-membership-picker";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { CharacterCreateButton } from "@/app/admin/characters/character-create-button";
import { CategoryPicker } from "@/app/components/characters/category-picker";
import { useMessages } from "@/lib/i18n/react";
import { SortableCategoryMembers } from "@/app/admin/characters/index/sortable-category-members";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import type { PermissionKey } from "@/lib/authz/permissions";
import {
  CHARACTER_DETAIL_PERMISSIONS,
  hasPermissionKey,
} from "@/lib/authz/permissions";
import type {
  CharacterBrowseNode,
  CharacterCategory,
  CharacterIndexData,
  CharacterIndexEntry,
  CharacterMembership,
  CharacterNameSelection,
} from "@/lib/character-index";
import {
  buildCharacterBrowseTree,
  characterMembershipNames,
  characterNodePath,
} from "@/lib/character-index";
import { characterNameKey } from "@/lib/character-names";
import type { ApiResponsePayload } from "@/lib/ui/api-response";
import { requestJson } from "@/lib/ui/api-response";
import { cn } from "@/lib/ui/cn";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Folder,
  Plus,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

type CategoryDraft = {
  kind: "category";
  categoryId: string | null;
  parentId: string | null;
  label: string;
  originalName: string;
  sourceUrl: string;
};
type CharacterDraft = {
  kind: "character";
  categoryId: string | null;
  characterId: number;
  targetCategoryId: string;
  sourceText: string;
  displayName: string;
  originalName: string;
};
type Draft = CategoryDraft | CharacterDraft;
const emptyCategory = (parentId: string | null): CategoryDraft => ({
  kind: "category",
  categoryId: null,
  parentId,
  label: "",
  originalName: "",
  sourceUrl: "",
});
const categoryDraft = (category: CharacterCategory): CategoryDraft => ({
  kind: "category",
  categoryId: category.id,
  parentId: category.parentId,
  label: category.label,
  originalName: category.originalName ?? "",
  sourceUrl: category.sourceUrl ?? "",
});
const characterDraft = (
  character: CharacterIndexEntry,
  categoryId: string | null,
  memberships: CharacterMembership[],
): CharacterDraft => ({
  kind: "character",
  ...characterMembershipNames(
    character,
    memberships.find(
      (member) =>
        member.characterId === character.id && member.categoryId === categoryId,
    ),
  ),
  categoryId,
  targetCategoryId: categoryId ?? "",
  sourceText: character.sourceUrls.join("\n"),
});

export function CharacterIndexEditor({
  initialData,
  initialCharacterId,
  initialCategoryId,
  permissionKeys,
}: {
  permissionKeys: readonly PermissionKey[];
  initialData: CharacterIndexData;
  initialCharacterId?: number;
  initialCategoryId?: string;
}) {
  const t = useMessages();
  const can = (key: PermissionKey) => hasPermissionKey(permissionKeys, key);
  const [data, setData] = useState(initialData);
  const [draft, setDraft] = useState<Draft>(() => {
    const role = initialData.characters.find(
      (item) => item.id === initialCharacterId,
    );
    if (role) {
      const memberships = initialData.memberships.filter(
        (member) => member.characterId === role.id,
      );
      const membership =
        memberships.find((member) => member.categoryId === initialCategoryId) ??
        memberships[0];
      return characterDraft(
        role,
        membership?.categoryId ?? null,
        initialData.memberships,
      );
    }
    const category = initialData.categories.find(
      (item) => item.id === initialCategoryId,
    );
    if (category) return categoryDraft(category);
    const first = initialData.categories.find((category) => !category.parentId);
    return first ? categoryDraft(first) : emptyCategory(null);
  });
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        initialData.categories
          .filter((category) => !category.parentId)
          .map((category) => category.id),
      ),
  );
  const [busy, setBusy] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const submitting = useRef(false);
  const toast = useToast();
  const [error, setError] = useState("");
  const [batchCharacters, setBatchCharacters] = useState<
    CharacterNameSelection[]
  >([]);
  const [unplacedOnly, setUnplacedOnly] = useState(false);
  const savedDraft = JSON.parse(baseline) as Draft;
  const sourceDirty =
    draft.kind === "character" &&
    savedDraft.kind === "character" &&
    draft.sourceText !== savedDraft.sourceText;
  const detailsDirty =
    JSON.stringify(
      draft.kind === "character" ? { ...draft, sourceText: "" } : draft,
    ) !==
    JSON.stringify(
      savedDraft.kind === "character"
        ? { ...savedDraft, sourceText: "" }
        : savedDraft,
    );
  const dirty = sourceDirty || detailsDirty;
  const canSaveDetails =
    draft.kind === "category"
      ? can(
          draft.categoryId
            ? "character_category.update"
            : "character_category.create",
        )
      : can(
          draft.categoryId
            ? "character_membership.update"
            : "character_membership.create",
        );
  const canRemove = can(
    draft.kind === "category"
      ? "character_category.delete"
      : "character_membership.delete",
  );
  // A different record must not inherit the select's native form synchronization state.
  const formKey =
    draft.kind === "character"
      ? `character:${draft.characterId}:${draft.categoryId}`
      : `category:${draft.categoryId ?? "new"}`;
  const roots = useMemo(
    () => buildCharacterBrowseTree(data, query).roots,
    [data, query],
  );
  const allRoots = useMemo(
    () => buildCharacterBrowseTree(data, "").roots,
    [data],
  );
  const categories = useMemo(
    () => new Map(data.categories.map((category) => [category.id, category])),
    [data.categories],
  );
  const character =
    draft.kind === "character"
      ? data.characters.find((item) => item.id === draft.characterId)
      : undefined;
  const unplaced = data.characters.filter(
    (item) =>
      !data.memberships.some((member) => member.characterId === item.id),
  );
  const ownMembers = data.memberships.filter(
    (member) => member.categoryId === draft.categoryId,
  );
  const selectedCategory = draft.categoryId
    ? categories.get(draft.categoryId)
    : undefined;
  const canSort = Boolean(draft.categoryId) && can("character_index.reorder");
  const childCount =
    ownMembers.length +
    data.categories.filter((category) => category.parentId === draft.categoryId)
      .length;

  function syncSelectionUrl(next: Draft) {
    const url = new URL(window.location.href);
    url.searchParams.delete("character");
    url.searchParams.delete("category");
    if (next.kind === "character")
      url.searchParams.set("character", String(next.characterId));
    if (next.categoryId) url.searchParams.set("category", next.categoryId);
    void navigateAccepted(`${url.pathname}${url.search}${url.hash}`, {
      replace: true,
      preventScrollReset: true,
    });
  }

  const confirm = useConfirm();
  const navigateAccepted = useNavigationGuard(
    dirty || busy || savingOrder,
    () =>
      !busy &&
      !savingOrder &&
      confirm(t("admin.characterIndex.leave")),
  );
  async function select(next: Draft) {
    if (
      busy ||
      (dirty && !(await confirm(t("admin.characterIndex.discardPrompt"), { title: t("admin.characterIndex.switch"), confirmLabel: t("admin.characterIndex.discardSwitch") })))
    )
      return;
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setError("");
    setBatchCharacters([]);
    syncSelectionUrl(next);
    setOpen((previous) => {
      const updated = new Set(previous);
      let category = next.categoryId
        ? categories.get(next.categoryId)
        : next.kind === "category" && next.parentId
          ? categories.get(next.parentId)
          : undefined;
      while (category && !updated.has(category.id)) {
        updated.add(category.id);
        category = category.parentId
          ? categories.get(category.parentId)
          : undefined;
      }
      return updated;
    });
  }
  function selectNode(node: CharacterBrowseNode, parentId: string | null) {
    if (node.kind === "character")
      select(characterDraft(node.character, parentId, data.memberships));
    else {
      const category = categories.get(node.id);
      if (category) select(categoryDraft(category));
    }
  }
  function changeCategory(patch: Partial<CategoryDraft>) {
    if (draft.kind === "category") {
      setDraft({ ...draft, ...patch });
    }
  }
  function changeCharacter(patch: Partial<CharacterDraft>) {
    if (draft.kind === "character") {
      setDraft({ ...draft, ...patch });
    }
  }
  async function submit(
    body: Record<string, unknown>,
    success: string,
    optimisticData?: CharacterIndexData,
  ) {
    if (submitting.current) {
      toast.info(t("admin.characterIndex.saveBusy"));
      return;
    }
    submitting.current = true;
    const sorting =
      body.operation === "reorder" || body.operation === "reorderTo";
    const previousData = data;
    if (optimisticData) setData(optimisticData);
    if (sorting) setSavingOrder(true);
    else setBusy(true);
    setError("");
    try {
      const result = await requestJson<
        ApiResponsePayload & {
          data: CharacterIndexData;
          categoryId: string | null;
          characterId: number | null;
        }
      >(
        "/api/admin/character-index",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        t("admin.characterIndex.saveFailed"),
      );
      setData(result.data);
      // Sorting changes order only; preserve the current editor and selection.
      if (sorting) return;
      const role = result.data.characters.find(
        (item) => item.id === result.characterId,
      );
      const category = result.data.categories.find(
        (item) => item.id === result.categoryId,
      );
      const next = role
        ? characterDraft(
            role,
            body.operation === "saveSources" && draft.kind === "character"
              ? draft.categoryId
              : result.categoryId,
            result.data.memberships,
          )
        : category
          ? categoryDraft(category)
          : emptyCategory(null);
      const retained =
        next.kind === "character" &&
        draft.kind === "character" &&
        next.characterId === draft.characterId
          ? body.operation === "saveSources"
            ? { ...draft, sourceText: next.sourceText }
            : { ...next, sourceText: draft.sourceText }
          : next;
      setDraft(retained);
      setBaseline(JSON.stringify(next));
      toast.success(success);
      setBatchCharacters([]);
      syncSelectionUrl(next);
      setOpen((previous) => {
        const expanded = new Set(previous);
        let ancestor = category;
        while (ancestor) {
          expanded.add(ancestor.id);
          ancestor = result.data.categories.find(
            (item) => item.id === ancestor?.parentId,
          );
        }
        return expanded;
      });
    } catch (reason) {
      if (optimisticData) setData(previousData);
      toast.error(reason instanceof Error ? reason : t("admin.characterIndex.saveRetry"));
    } finally {
      submitting.current = false;
      if (sorting) setSavingOrder(false);
      else setBusy(false);
    }
  }
  function renderTree(
    nodes: CharacterBrowseNode[],
    parentId: string | null,
  ): ReactNode {
    return nodes.map((node) => {
      const expanded = Boolean(query) || open.has(node.id);
      const selected =
        node.kind === "category"
          ? draft.kind === "category" && draft.categoryId === node.id
          : draft.kind === "character" &&
            draft.characterId === node.character.id &&
            draft.categoryId === parentId;
      return (
        <div key={node.id}>
          <div
            className={cn(
              "flex items-center rounded-sm",
              selected && "bg-primary/10 text-primary",
            )}
          >
            {node.kind === "category" ? (
              <Button
                aria-label={t(expanded ? "character.collapseGroup" : "character.expandGroup", { label: node.label })}
                aria-expanded={expanded}
                className="size-8 min-h-8 shrink-0 p-0"
                variant="ghost"
                type="button"
                onClick={() =>
                  setOpen((previous) => {
                    const next = new Set(previous);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
              >
                <ChevronRight
                  aria-hidden
                  size={14}
                  className={cn(expanded && "rotate-90")}
                />
              </Button>
            ) : (
              <span className="w-8 shrink-0" />
            )}
            <Button
              aria-current={selected ? "true" : undefined}
              className="min-h-8 min-w-0 flex-1 justify-start gap-2 whitespace-normal px-1 py-1 text-left text-xs font-normal"
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => selectNode(node, parentId)}
            >
              {node.kind === "category" ? (
                <Folder aria-hidden size={14} className="shrink-0" />
              ) : (
                <UserRound aria-hidden size={14} className="shrink-0" />
              )}
              <span className="min-w-0 wrap-anywhere">{node.label}</span>
            </Button>
          </div>
          {node.kind === "category" && expanded ? (
            <div className="ml-3 border-l border-border pl-1">
              {renderTree(node.children, node.id)}
            </div>
          ) : null}
        </div>
      );
    });
  }
  function findChildren(nodes: CharacterBrowseNode[]): CharacterBrowseNode[] {
    for (const node of nodes) {
      if (node.id === draft.categoryId) return node.children;
      const found = findChildren(node.children);
      if (found.length) return found;
    }
    return [];
  }
  return (
    <div className="flex flex-col items-start gap-5 lg:flex-row">
      <aside className="admin-workspace-panel w-full shrink-0 border border-border bg-card lg:sticky lg:top-20 lg:w-76">
        <div className="grid gap-3 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t("admin.characterIndex.tree")}</h2>
            <span role="status" className="text-xs text-muted">
              {savingOrder ? t("admin.characterIndex.savingOrder") : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={busy || !can("character_category.create")}
              onClick={() => select(emptyCategory(null))}
            >
              <Plus aria-hidden size={14} />
              {t("admin.characterIndex.root")}
            </Button>
          </div>
          <Input
            aria-label={t("admin.characterIndex.search")}
            type="search"
            placeholder={t("admin.characterIndex.searchHint")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <p className="text-xs text-muted">
            {t("admin.characterIndex.counts", { categories: data.categories.length, characters: data.characters.length, unplaced: unplaced.length })}
          </p>
        </div>
        <nav
          aria-label={t("admin.characterIndex.editTree")}
          className="max-h-80 overflow-y-auto p-2 lg:max-h-[calc(100dvh-17rem)]"
        >
          {renderTree(roots, null)}
          {unplaced.length ? (
            <div className="mt-3 border-t border-border pt-2">
              <h3 className="px-2 py-1 text-xs text-muted">{t("character.uncategorized")}</h3>
              {unplaced
                .filter((item) =>
                  characterNameKey(
                    [
                      item.primaryName,
                      item.originalName,
                      ...item.aliases.map((alias) => alias.name),
                    ].join(" "),
                  ).includes(characterNameKey(query)),
                )
                .map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    className="w-full justify-start text-xs"
                    disabled={busy}
                    onClick={() =>
                      select(characterDraft(item, null, data.memberships))
                    }
                  >
                    <UserRound aria-hidden size={14} />
                    {item.primaryName}
                  </Button>
                ))}
            </div>
          ) : null}
        </nav>
      </aside>
      <section
        aria-label={t("admin.characterIndex.editPanel")}
        className="admin-workspace-panel w-full min-w-0 flex-1 border border-border bg-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <p className="mb-1 break-words text-xs text-muted">
              {draft.kind === "character" ? t("admin.characterIndex.character") : t("admin.characterIndex.category")}
            </p>
            <h2 className="text-lg font-semibold">
              {draft.kind === "character"
                ? draft.displayName
                : draft.label || t("admin.characterIndex.new")}
            </h2>
          </div>
          {canSort ? (
            <div className="flex items-center gap-1">
              {(["up", "down"] as const).map((direction) => (
                <Button
                  key={direction}
                  aria-label={direction === "up" ? t("admin.characterIndex.up") : t("admin.characterIndex.down")}
                  title={direction === "up" ? t("admin.characterIndex.up") : t("admin.characterIndex.down")}
                  size="icon"
                  variant="ghost"
                  type="button"
                  disabled={busy || savingOrder || dirty}
                  onClick={() =>
                    void submit(
                      {
                        operation: "reorder",
                        categoryId: draft.categoryId,
                        characterId:
                          draft.kind === "character" ? draft.characterId : null,
                        direction,
                      },
                      t("admin.characterIndex.orderSaved"),
                    )
                  }
                >
                  {direction === "up" ? (
                    <ArrowUp aria-hidden size={16} />
                  ) : (
                    <ArrowDown aria-hidden size={16} />
                  )}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <form
          key={formKey}
          className="grid gap-5 p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.kind === "character" && !draft.targetCategoryId) {
              setError(t("admin.characterIndex.categoryRequired"));
              return;
            }
            void submit(
              draft.kind === "category"
                ? { ...draft, operation: "saveCategory" }
                : draft.categoryId
                  ? { ...draft, operation: "saveMembership" }
                  : {
                      operation: "addCharacters",
                      categoryId: draft.targetCategoryId,
                      characters: [
                        {
                          characterId: draft.characterId,
                          displayName: draft.displayName,
                          originalName: draft.originalName,
                        },
                      ],
                    },
              t("admin.characterIndex.saved"),
            );
          }}
        >
          <fieldset className="grid min-w-0 gap-5" disabled={busy}>
            {draft.kind === "category" ? (
              <>
                <div>
                  <Label htmlFor="category-parent">{t("character.categoryPicker.parent")}</Label>
                  <CategoryPicker
                    id="category-parent"
                    mode="parent"
                    categories={data.categories}
                    categoryId={draft.categoryId}
                    disabled={busy || !canSaveDetails}
                    value={draft.parentId}
                    onValueChange={(parentId) => changeCategory({ parentId })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="category-label">{t("admin.characterIndex.categoryName")}</Label>
                    <Input
                      id="category-label"
                      disabled={!canSaveDetails}
                      required
                      maxLength={160}
                      value={draft.label}
                      onChange={(event) =>
                        changeCategory({ label: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="category-original">{t("admin.characterIndex.originalName")}</Label>
                    <Input
                      id="category-original"
                      disabled={!canSaveDetails}
                      maxLength={160}
                      value={draft.originalName}
                      onChange={(event) =>
                        changeCategory({ originalName: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="category-source">{t("admin.characterIndex.sourceUrl")}</Label>
                  <Input
                    id="category-source"
                    disabled={!canSaveDetails}
                    type="url"
                    maxLength={2048}
                    placeholder="https://"
                    value={draft.sourceUrl}
                    onChange={(event) =>
                      changeCategory({ sourceUrl: event.target.value })
                    }
                  />
                </div>
              </>
            ) : character ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <CharacterPortrait
                    className="size-16 rounded-md"
                    displayName={draft.displayName}
                    portrait={character.portrait}
                  />
                  <div className="mr-auto">
                    <p lang="ja" className="text-sm text-muted">
                      {draft.originalName}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {t("admin.characterIndex.publicWorks", { count: character.workCount })}
                    </p>
                  </div>
                  {CHARACTER_DETAIL_PERMISSIONS.some(can) ? (
                    <Link
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                      to={`/admin/characters/${character.id}`}
                    >
                      {t("admin.characterIndex.profileMaterials")}
                    </Link>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="character-category">{t("character.categoryPicker.membership")}</Label>
                  <CategoryPicker
                    id="character-category"
                    mode="membership"
                    categories={data.categories}
                    disabled={busy || !canSaveDetails}
                    value={draft.targetCategoryId || null}
                    onValueChange={(targetCategoryId) => {
                      if (targetCategoryId)
                        changeCharacter({ targetCategoryId });
                    }}
                  />
                </div>
                <CharacterNameFields
                  character={character}
                  selected={draft}
                  disabled={busy || !canSaveDetails}
                  onChange={changeCharacter}
                />
                {data.memberships.some(
                  (member) =>
                    member.characterId === character.id &&
                    member.categoryId !== draft.categoryId,
                ) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">{t("admin.characterIndex.alsoIn")}</span>
                    {data.memberships
                      .filter(
                        (member) =>
                          member.characterId === character.id &&
                          member.categoryId !== draft.categoryId,
                      )
                      .map((member) => (
                        <Button
                          key={member.categoryId}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            select(
                              characterDraft(
                                character,
                                member.categoryId,
                                data.memberships,
                              ),
                            )
                          }
                        >
                          {characterNodePath(
                            data.categories,
                            member.categoryId,
                          )}
                        </Button>
                      ))}
                  </div>
                ) : null}
              </>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="admin-save-bar">
              <Button
                type="submit"
                disabled={
                  busy ||
                  !canSaveDetails ||
                  (!detailsDirty && Boolean(draft.categoryId)) ||
                  (draft.kind === "character" && !draft.targetCategoryId)
                }
              >
                <Save aria-hidden size={16} />
                {busy ? t("admin.characterIndex.saving") : t("admin.characterIndex.save")}
              </Button>
              {dirty ? (
                <>
                  <span className="text-xs text-muted">{t("admin.characterIndex.unsaved")}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDraft(JSON.parse(baseline) as Draft);
                      setError("");
                    }}
                  >
                    {t("admin.characterIndex.restore")}
                  </Button>
                </>
              ) : null}
              {draft.categoryId && canRemove ? (
                <Button
                  className="ml-auto"
                  type="button"
                  variant="ghost"
                  disabled={
                    busy ||
                    dirty ||
                    (draft.kind === "category" && childCount > 0)
                  }
                  onClick={async () => {
                    const prompt =
                      draft.kind === "category"
                        ? t("admin.characterIndex.deletePrompt", { name: draft.label })
                        : t("admin.characterIndex.removePrompt", { name: character?.primaryName ?? "", category: selectedCategory?.label ?? "" });
                    if (await confirm(prompt, { title: draft.kind === "category" ? t("admin.characterIndex.delete") : t("admin.characterIndex.remove"), confirmLabel: draft.kind === "category" ? t("admin.characterIndex.delete") : t("admin.characterIndex.remove"), destructive: true }))
                      void submit(
                        {
                          operation:
                            draft.kind === "category"
                              ? "deleteCategory"
                              : "removeCharacter",
                          categoryId: draft.categoryId,
                          characterId:
                            draft.kind === "character"
                              ? draft.characterId
                              : null,
                        },
                        draft.kind === "category" ? t("admin.characterIndex.deleted") : t("admin.characterIndex.removed"),
                      );
                  }}
                >
                  <Trash2 aria-hidden size={15} />
                  {draft.kind === "category" ? t("admin.characterIndex.deleteEmpty") : t("admin.characterIndex.remove")}
                </Button>
              ) : null}
            </div>
          </fieldset>
        </form>
        {draft.kind === "character" ? (
          <section
            aria-label={t("admin.characterIndex.sources")}
            className="grid gap-3 border-t border-border p-4 sm:p-5"
          >
            <Label htmlFor="character-sources">
              {t("admin.characterIndex.sourcesLabel")}
            </Label>
            <Textarea
              id="character-sources"
              rows={4}
              disabled={busy || !can("character.sources.update_any")}
              value={draft.sourceText}
              onChange={(event) =>
                changeCharacter({ sourceText: event.target.value })
              }
            />
            {can("character.sources.update_any") ? (
              <div>
                <Button
                  type="button"
                  disabled={busy || !sourceDirty}
                  onClick={() =>
                    void submit(
                      {
                        operation: "saveSources",
                        characterId: draft.characterId,
                        sourceUrls: draft.sourceText
                          .split(/\r?\n/)
                          .map((url) => url.trim())
                          .filter(Boolean),
                      },
                      t("admin.characterIndex.sourcesSaved"),
                    )
                  }
                >
                  {t("admin.characterIndex.saveSources")}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
        {draft.kind === "category" && draft.categoryId ? (
          <section
            className="grid gap-4 border-t border-border p-4 sm:p-5"
            aria-label={t("admin.characterIndex.members")}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto font-semibold">{t("admin.characterIndex.membersCount", { count: childCount })}</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || dirty || !can("character_category.create")}
                onClick={() => select(emptyCategory(draft.categoryId))}
              >
                <Plus aria-hidden size={14} />
                {t("admin.characterIndex.child")}
              </Button>
              {can("character.create") ? (
                <CharacterCreateButton disabled={busy || dirty} />
              ) : null}
            </div>
            <SortableCategoryMembers
              key={draft.categoryId}
              nodes={findChildren(allRoots)}
              busy={busy}
              sortDisabled={
                busy || savingOrder || dirty || !can("character_index.reorder")
              }
              onSelect={(child) => selectNode(child, draft.categoryId)}
              onReorder={(nodes, move) => {
                if (
                  !draft.categoryId ||
                  busy ||
                  dirty ||
                  !can("character_index.reorder")
                )
                  return;
                const categoryOrder = new Map(
                  nodes.flatMap((node, order) =>
                    node.kind === "category" ? [[node.id, order] as const] : [],
                  ),
                );
                const memberOrder = new Map(
                  nodes.flatMap((node, order) =>
                    node.kind === "character"
                      ? [[node.character.id, order] as const]
                      : [],
                  ),
                );
                const optimisticData = {
                  ...data,
                  categories: data.categories.map((item) =>
                    categoryOrder.has(item.id)
                      ? { ...item, sortOrder: categoryOrder.get(item.id)! }
                      : item,
                  ),
                  memberships: data.memberships.map((member) =>
                    member.categoryId === draft.categoryId &&
                    memberOrder.has(member.characterId)
                      ? {
                          ...member,
                          sortOrder: memberOrder.get(member.characterId)!,
                        }
                      : member,
                  ),
                };
                void submit(
                  {
                    operation: "reorderTo",
                    categoryId: draft.categoryId,
                    ...move,
                  },
                  t("admin.characterIndex.orderSaved"),
                  optimisticData,
                );
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">{t("admin.characterIndex.addExisting")}</h4>
              <Button
                type="button"
                size="sm"
                variant={unplacedOnly ? "neutral" : "ghost"}
                aria-pressed={unplacedOnly}
                onClick={() => setUnplacedOnly(!unplacedOnly)}
                disabled={busy}
              >
                {unplacedOnly
                  ? t("admin.characterIndex.showAll")
                  : t("admin.characterIndex.onlyUncategorized", { count: unplaced.length })}
              </Button>
            </div>
            <CharacterMembershipPicker
              characters={data.characters}
              selected={batchCharacters}
              onChange={setBatchCharacters}
              disabled={busy || dirty || !can("character_membership.create")}
              excludeIds={[
                ...ownMembers.map((member) => member.characterId),
                ...(unplacedOnly
                  ? data.memberships.map((member) => member.characterId)
                  : []),
              ]}
            />
            <div>
              <Button
                type="button"
                disabled={
                  busy ||
                  dirty ||
                  !can("character_membership.create") ||
                  !batchCharacters.length
                }
                onClick={() =>
                  void submit(
                    {
                      operation: "addCharacters",
                      categoryId: draft.categoryId,
                      characters: batchCharacters,
                    },
                    t("admin.characterIndex.memberAdded"),
                  )
                }
              >
                <Plus aria-hidden size={16} />
                {t("admin.characterIndex.addSelected")}
                {batchCharacters.length ? ` (${batchCharacters.length})` : ""}
              </Button>
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
