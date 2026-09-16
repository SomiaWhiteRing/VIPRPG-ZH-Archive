"use client";

import Link from "next/link";
import { CHARACTER_DETAIL_PERMISSIONS, hasPermissionKey, type PermissionKey } from "@/lib/authz/permissions";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Folder, Plus, Save, Trash2, UserRound, X } from "lucide-react";
import { CharacterCreateButton } from "@/app/admin/characters/character-create-button";
import { SortableCategoryMembers } from "@/app/admin/characters/index/sortable-category-members";
import { CategoryPicker } from "@/app/admin/characters/index/category-picker";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { SelectField } from "@/app/components/ui/select";
import { buildCharacterBrowseTree, characterMembershipNames, characterNameOptions, characterNodePath, type CharacterBrowseNode, type CharacterCategory, type CharacterIndexData, type CharacterIndexEntry, type CharacterMembership, type CharacterNameSelection } from "@/lib/character-index";
import { characterNameKey } from "@/lib/character-names";
import { requestJson, type ApiResponsePayload } from "@/lib/ui/api-response";
import { cn } from "@/lib/ui/cn";

type CategoryDraft = { kind: "category"; categoryId: string | null; parentId: string | null; label: string; originalName: string; sourceUrl: string };
type CharacterDraft = { kind: "character"; categoryId: string | null; characterId: number; targetCategoryId: string; sourceText: string; displayName: string; originalName: string };
type Draft = CategoryDraft | CharacterDraft;
const emptyCategory = (parentId: string | null): CategoryDraft => ({ kind: "category", categoryId: null, parentId, label: "", originalName: "", sourceUrl: "" });
const categoryDraft = (category: CharacterCategory): CategoryDraft => ({ kind: "category", categoryId: category.id, parentId: category.parentId, label: category.label, originalName: category.originalName ?? "", sourceUrl: category.sourceUrl ?? "" });
const characterDraft = (character: CharacterIndexEntry, categoryId: string | null, memberships: CharacterMembership[]): CharacterDraft => ({ kind: "character", ...characterMembershipNames(character, memberships.find((member) => member.characterId === character.id && member.categoryId === categoryId)), categoryId, targetCategoryId: categoryId ?? "", sourceText: character.sourceUrls.join("\n") });

export function CharacterIndexEditor({ initialData, initialCharacterId, initialCategoryId, permissionKeys }: { permissionKeys: readonly PermissionKey[]; initialData: CharacterIndexData; initialCharacterId?: number; initialCategoryId?: string }) {
  const can = (key: PermissionKey) => hasPermissionKey(permissionKeys, key);
  const [data, setData] = useState(initialData);
  const [draft, setDraft] = useState<Draft>(() => {
    const role = initialData.characters.find((item) => item.id === initialCharacterId);
    if (role) {
      const memberships = initialData.memberships.filter((member) => member.characterId === role.id);
      const membership = memberships.find((member) => member.categoryId === initialCategoryId) ?? memberships[0];
      return characterDraft(role, membership?.categoryId ?? null, initialData.memberships);
    }
    const category = initialData.categories.find((item) => item.id === initialCategoryId);
    if (category) return categoryDraft(category);
    const first = initialData.categories.find((category) => !category.parentId);
    return first ? categoryDraft(first) : emptyCategory(null);
  });
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialData.categories.filter((category) => !category.parentId).map((category) => category.id)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [batchCharacters, setBatchCharacters] = useState<CharacterNameSelection[]>([]);
  const [unplacedOnly, setUnplacedOnly] = useState(false);
  const savedDraft = JSON.parse(baseline) as Draft;
  const sourceDirty = draft.kind === "character" && savedDraft.kind === "character" && draft.sourceText !== savedDraft.sourceText;
  const detailsDirty = JSON.stringify(draft.kind === "character" ? { ...draft, sourceText: "" } : draft) !== JSON.stringify(savedDraft.kind === "character" ? { ...savedDraft, sourceText: "" } : savedDraft);
  const dirty = sourceDirty || detailsDirty;
  const canSaveDetails = draft.kind === "category"
    ? can(draft.categoryId ? "character_category.update" : "character_category.create")
    : can(draft.categoryId ? "character_membership.update" : "character_membership.create");
  const canRemove = can(draft.kind === "category" ? "character_category.delete" : "character_membership.delete");
  // A different record must not inherit the select's native form synchronization state.
  const formKey = draft.kind === "character" ? `character:${draft.characterId}:${draft.categoryId}` : `category:${draft.categoryId ?? "new"}`;
  const roots = useMemo(() => buildCharacterBrowseTree(data, query).roots, [data, query]);
  const allRoots = useMemo(() => buildCharacterBrowseTree(data, "").roots, [data]);
  const categories = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);
  const character = draft.kind === "character" ? data.characters.find((item) => item.id === draft.characterId) : undefined;
  const unplaced = data.characters.filter((item) => !data.memberships.some((member) => member.characterId === item.id));
  const ownMembers = data.memberships.filter((member) => member.categoryId === draft.categoryId);
  const selectedCategory = draft.categoryId ? categories.get(draft.categoryId) : undefined;
  const canSort = Boolean(draft.categoryId) && can("character_index.reorder");
  const childCount = ownMembers.length + data.categories.filter((category) => category.parentId === draft.categoryId).length;

  function syncSelectionUrl(next: Draft) {
    const url = new URL(window.location.href);
    url.searchParams.delete("character");
    url.searchParams.delete("category");
    if (next.kind === "character") url.searchParams.set("character", String(next.characterId));
    if (next.categoryId) url.searchParams.set("category", next.categoryId);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const guardHistory = (event: NavigateEvent) => {
      if (event.navigationType !== "traverse" || !event.cancelable || !event.destination.sameDocument || event.hashChange) return;
      const target = new URL(event.destination.url);
      if (target.pathname === location.pathname && target.search === location.search) return;
      if (busy || !window.confirm("当前修改尚未保存。放弃修改并离开？")) event.preventDefault();
    };
    const guardLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor?.hasAttribute("href") || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const target = new URL(anchor.href);
      if (target.origin !== window.location.origin || (target.pathname === window.location.pathname && target.search === window.location.search)) return;
      if (busy || !window.confirm("当前修改尚未保存。放弃修改并离开？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    window.navigation?.addEventListener("navigate", guardHistory);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.navigation?.removeEventListener("navigate", guardHistory);
      document.removeEventListener("click", guardLink, true);
    };
  }, [dirty, busy]);
  function select(next: Draft) {
    if (busy || (dirty && !window.confirm("当前修改尚未保存。放弃修改并切换？"))) return;
    setDraft(next); setBaseline(JSON.stringify(next)); setError(""); setMessage(""); setBatchCharacters([]);
    syncSelectionUrl(next);
    setOpen((previous) => {
      const updated = new Set(previous);
      let category = next.categoryId ? categories.get(next.categoryId) : next.kind === "category" && next.parentId ? categories.get(next.parentId) : undefined;
      while (category && !updated.has(category.id)) { updated.add(category.id); category = category.parentId ? categories.get(category.parentId) : undefined; }
      return updated;
    });
  }
  function selectNode(node: CharacterBrowseNode, parentId: string | null) {
    if (node.kind === "character") select(characterDraft(node.character, parentId, data.memberships));
    else { const category = categories.get(node.id); if (category) select(categoryDraft(category)); }
  }
  function changeCategory(patch: Partial<CategoryDraft>) { if (draft.kind === "category") { setDraft({ ...draft, ...patch }); setMessage(""); } }
  function changeCharacter(patch: Partial<CharacterDraft>) { if (draft.kind === "character") { setDraft({ ...draft, ...patch }); setMessage(""); } }
  async function submit(body: Record<string, unknown>, success: string, optimisticData?: CharacterIndexData) {
    if (busy) return;
    const previousData = data;
    if (optimisticData) setData(optimisticData);
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestJson<ApiResponsePayload & { data: CharacterIndexData; categoryId: string | null; characterId: number | null }>("/api/admin/character-index", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }, "保存失败");
      setData(result.data);
      const role = result.data.characters.find((item) => item.id === result.characterId);
      const category = result.data.categories.find((item) => item.id === result.categoryId);
      const next = role ? characterDraft(role, body.operation === "saveSources" && draft.kind === "character" ? draft.categoryId : result.categoryId, result.data.memberships) : category ? categoryDraft(category) : emptyCategory(null);
      const retained = next.kind === "character" && draft.kind === "character" && next.characterId === draft.characterId
        ? body.operation === "saveSources"
          ? { ...draft, sourceText: next.sourceText }
          : { ...next, sourceText: draft.sourceText }
        : next;
      setDraft(retained); setBaseline(JSON.stringify(next)); setMessage(success); setBatchCharacters([]);
      syncSelectionUrl(next);
      setOpen((previous) => {
        const expanded = new Set(previous); let ancestor = category;
        while (ancestor) { expanded.add(ancestor.id); ancestor = result.data.categories.find((item) => item.id === ancestor?.parentId); }
        return expanded;
      });
    } catch (reason) { if (optimisticData) setData(previousData); setError(reason instanceof Error ? reason.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  function renderTree(nodes: CharacterBrowseNode[], parentId: string | null): ReactNode {
    return nodes.map((node) => {
      const expanded = Boolean(query) || open.has(node.id);
      const selected = node.kind === "category" ? draft.kind === "category" && draft.categoryId === node.id : draft.kind === "character" && draft.characterId === node.character.id && draft.categoryId === parentId;
      return <div key={node.id}>
        <div className={cn("flex items-center rounded-sm", selected && "bg-primary/10 text-primary")}>
          {node.kind === "category" ? <Button aria-label={`${expanded ? "收起" : "展开"}${node.label}`} aria-expanded={expanded} className="size-8 min-h-8 shrink-0 p-0" variant="ghost" type="button" onClick={() => setOpen((previous) => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}><ChevronRight aria-hidden size={14} className={cn(expanded && "rotate-90")} /></Button> : <span className="w-8 shrink-0" />}
          <Button aria-current={selected ? "true" : undefined} className="min-h-8 min-w-0 flex-1 justify-start gap-2 whitespace-normal px-1 py-1 text-left text-xs font-normal" variant="ghost" type="button" disabled={busy} onClick={() => selectNode(node, parentId)}>
            {node.kind === "category" ? <Folder aria-hidden size={14} className="shrink-0" /> : <UserRound aria-hidden size={14} className="shrink-0" />}
            <span className="min-w-0 break-words">{node.label}</span>
          </Button>
        </div>
        {node.kind === "category" && expanded ? <div className="ml-3 border-l border-border pl-1">{renderTree(node.children, node.id)}</div> : null}
      </div>;
    });
  }
  function findChildren(nodes: CharacterBrowseNode[]): CharacterBrowseNode[] {
    for (const node of nodes) { if (node.id === draft.categoryId) return node.children; const found = findChildren(node.children); if (found.length) return found; }
    return [];
  }
  return <div className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
    <aside className="rounded-md border border-border bg-card lg:sticky lg:top-20">
      <div className="grid gap-3 border-b border-border p-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">分类与角色</h2><Button size="sm" variant="outline" type="button" disabled={busy || !can("character_category.create")} onClick={() => select(emptyCategory(null))}><Plus aria-hidden size={14} />一级分类</Button></div>
        <Input aria-label="搜索分类或角色" type="search" placeholder="搜索分类、角色或别名" value={query} onChange={(event) => setQuery(event.target.value)} />
        <p className="text-xs text-muted">{data.categories.length} 个分类 · {data.characters.length} 位角色 · {unplaced.length} 位未分类</p>
      </div>
      <nav aria-label="编辑角色分类" className="max-h-80 overflow-y-auto p-2 lg:max-h-[calc(100dvh-17rem)]">
        {renderTree(roots, null)}
        {unplaced.length ? <div className="mt-3 border-t border-border pt-2"><h3 className="px-2 py-1 text-xs text-muted">未分类</h3>{unplaced.filter((item) => characterNameKey([item.primaryName, item.originalName, ...item.aliases.map((alias) => alias.name)].join(" ")).includes(characterNameKey(query))).map((item) => <Button key={item.id} type="button" variant="ghost" className="w-full justify-start text-xs" disabled={busy} onClick={() => select(characterDraft(item, null, data.memberships))}><UserRound aria-hidden size={14} />{item.primaryName}</Button>)}</div> : null}
      </nav>
    </aside>
    <section aria-label="编辑分类或角色" className="min-w-0 rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div><p className="mb-1 break-words text-xs text-muted">{draft.kind === "character" ? "角色" : "分类"}</p><h2 className="text-lg font-semibold">{draft.kind === "character" ? draft.displayName : draft.label || "新建分类"}</h2></div>
        {canSort ? <div className="flex items-center gap-1">{(["up", "down"] as const).map((direction) => <Button key={direction} aria-label={direction === "up" ? "上移" : "下移"} title={direction === "up" ? "上移" : "下移"} size="icon" variant="ghost" type="button" disabled={busy || dirty} onClick={() => void submit({ operation: "reorder", categoryId: draft.categoryId, characterId: draft.kind === "character" ? draft.characterId : null, direction }, "顺序已更新")}>{direction === "up" ? <ArrowUp aria-hidden size={16} /> : <ArrowDown aria-hidden size={16} />}</Button>)}</div> : null}
      </div>
      <form key={formKey} className="grid gap-5 p-4 sm:p-5" onSubmit={(event) => { event.preventDefault(); if (draft.kind === "character" && !draft.targetCategoryId) { setError("请选择所属分类。"); return; } void submit(draft.kind === "category" ? { ...draft, operation: "saveCategory" } : draft.categoryId ? { ...draft, operation: "saveMembership" } : { operation: "addCharacters", categoryId: draft.targetCategoryId, characters: [{ characterId: draft.characterId, displayName: draft.displayName, originalName: draft.originalName }] }, "已保存"); }}>
        <fieldset className="grid min-w-0 gap-5" disabled={busy}>
          {draft.kind === "category" ? <>
            <div><Label htmlFor="category-parent">上级分类</Label><CategoryPicker id="category-parent" mode="parent" categories={data.categories} categoryId={draft.categoryId} disabled={busy || !canSaveDetails} value={draft.parentId} onValueChange={(parentId) => changeCategory({ parentId })} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="category-label">分类名称</Label><Input id="category-label" disabled={!canSaveDetails} required maxLength={160} value={draft.label} onChange={(event) => changeCategory({ label: event.target.value })} /></div>
              <div><Label htmlFor="category-original">日文原名（可选）</Label><Input id="category-original" disabled={!canSaveDetails} maxLength={160} value={draft.originalName} onChange={(event) => changeCategory({ originalName: event.target.value })} /></div>
            </div>
            <div><Label htmlFor="category-source">来源链接（可选）</Label><Input id="category-source" disabled={!canSaveDetails} type="url" maxLength={2048} placeholder="https://" value={draft.sourceUrl} onChange={(event) => changeCategory({ sourceUrl: event.target.value })} /></div>
          </> : character ? <>
            <div className="flex flex-wrap items-center gap-3"><CharacterPortrait className="size-16 rounded-md" displayName={draft.displayName} portrait={character.portrait} /><div className="mr-auto"><p lang="ja" className="text-sm text-muted">{draft.originalName}</p><p className="mt-1 text-xs text-muted">{character.workCount} 部公开作品</p></div>{CHARACTER_DETAIL_PERMISSIONS.some(can) ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/characters/${character.id}`}>角色资料与素材</Link> : null}</div>
            <div><Label htmlFor="character-category">所属分类</Label><CategoryPicker id="character-category" mode="membership" categories={data.categories} disabled={busy || !canSaveDetails} value={draft.targetCategoryId || null} onValueChange={(targetCategoryId) => { if (targetCategoryId) changeCharacter({ targetCategoryId }); }} /></div>
            <CharacterNameFields character={character} selected={draft} disabled={busy || !canSaveDetails} onChange={changeCharacter} />
            {data.memberships.some((member) => member.characterId === character.id && member.categoryId !== draft.categoryId) ? <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted">同时属于</span>{data.memberships.filter((member) => member.characterId === character.id && member.categoryId !== draft.categoryId).map((member) => <Button key={member.categoryId} type="button" variant="outline" size="sm" onClick={() => select(characterDraft(character, member.categoryId, data.memberships))}>{characterNodePath(data.categories, member.categoryId)}</Button>)}</div> : null}
          </> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {message ? <p role="status" className="text-sm text-primary">{message}</p> : null}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="submit" disabled={busy || !canSaveDetails || (!detailsDirty && Boolean(draft.categoryId)) || (draft.kind === "character" && !draft.targetCategoryId)}><Save aria-hidden size={16} />{busy ? "保存中…" : "保存修改"}</Button>
            {dirty ? <><span className="text-xs text-muted">有未保存修改</span><Button type="button" variant="ghost" onClick={() => { setDraft(JSON.parse(baseline) as Draft); setError(""); }}>还原修改</Button></> : null}
            {draft.categoryId && canRemove ? <Button className="ml-auto" type="button" variant="ghost" disabled={busy || dirty || (draft.kind === "category" && childCount > 0)} onClick={() => {
              const prompt = draft.kind === "category" ? `删除空分类“${draft.label}”？` : `将“${character?.primaryName}”移出“${selectedCategory?.label}”？角色资料会保留。`;
              if (window.confirm(prompt)) void submit({ operation: draft.kind === "category" ? "deleteCategory" : "removeCharacter", categoryId: draft.categoryId, characterId: draft.kind === "character" ? draft.characterId : null }, draft.kind === "category" ? "分类已删除" : "已移出分类");
            }}><Trash2 aria-hidden size={15} />{draft.kind === "category" ? "删除空分类" : "移出分类"}</Button> : null}
          </div>
        </fieldset>
      </form>
      {draft.kind === "character" ? <section aria-label="角色来源" className="grid gap-3 border-t border-border p-4 sm:p-5">
        <Label htmlFor="character-sources">角色来源链接（每行一个，可选）</Label>
        <Textarea id="character-sources" rows={4} disabled={busy || !can("character.sources.update_any")} value={draft.sourceText} onChange={(event) => changeCharacter({ sourceText: event.target.value })} />
        {can("character.sources.update_any") ? <div><Button type="button" disabled={busy || !sourceDirty} onClick={() => void submit({ operation: "saveSources", characterId: draft.characterId, sourceUrls: draft.sourceText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean) }, "角色来源已保存")}>保存来源</Button></div> : null}
      </section> : null}
      {draft.kind === "category" && draft.categoryId ? <section className="grid gap-4 border-t border-border p-4 sm:p-5" aria-label="分类成员">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto font-semibold">分类成员 · {childCount}</h3><Button type="button" size="sm" variant="outline" disabled={busy || dirty || !can("character_category.create")} onClick={() => select(emptyCategory(draft.categoryId))}><Plus aria-hidden size={14} />子分类</Button>{can("character.create") ? <CharacterCreateButton disabled={busy || dirty} /> : null}</div>
        <SortableCategoryMembers key={draft.categoryId} nodes={findChildren(allRoots)} busy={busy} sortDisabled={busy || dirty || !can("character_index.reorder")}
          onSelect={(child) => selectNode(child, draft.categoryId)} onReorder={(nodes, move) => {
            if (!draft.categoryId || busy || dirty || !can("character_index.reorder")) return;
            const categoryOrder = new Map(nodes.flatMap((node, order) => node.kind === "category" ? [[node.id, order] as const] : []));
            const memberOrder = new Map(nodes.flatMap((node, order) => node.kind === "character" ? [[node.character.id, order] as const] : []));
            const optimisticData = { ...data,
              categories: data.categories.map((item) => categoryOrder.has(item.id) ? { ...item, sortOrder: categoryOrder.get(item.id)! } : item),
              memberships: data.memberships.map((member) => member.categoryId === draft.categoryId && memberOrder.has(member.characterId)
                ? { ...member, sortOrder: memberOrder.get(member.characterId)! } : member),
            };
            void submit({ operation: "reorderTo", categoryId: draft.categoryId, ...move }, "顺序已更新", optimisticData);
          }} />
        <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">加入已有角色</h4><Button type="button" size="sm" variant={unplacedOnly ? "secondary" : "ghost"} aria-pressed={unplacedOnly} onClick={() => setUnplacedOnly(!unplacedOnly)} disabled={busy}>{unplacedOnly ? "显示全部角色" : `仅看未分类 (${unplaced.length})`}</Button></div>
        <CharacterPicker characters={data.characters} selected={batchCharacters} onChange={setBatchCharacters} disabled={busy || dirty || !can("character_membership.create")} excludeIds={[...ownMembers.map((member) => member.characterId), ...(unplacedOnly ? data.memberships.map((member) => member.characterId) : [])]} />
        <div><Button type="button" disabled={busy || dirty || !can("character_membership.create") || !batchCharacters.length} onClick={() => void submit({ operation: "addCharacters", categoryId: draft.categoryId, characters: batchCharacters }, "角色已加入分类")}><Plus aria-hidden size={16} />加入所选角色{batchCharacters.length ? ` (${batchCharacters.length})` : ""}</Button></div>
      </section> : null}
    </section>
  </div>;
}
function CharacterNameFields({ character, selected, onChange, disabled }: {
  character: CharacterIndexEntry; selected: Pick<CharacterNameSelection, "displayName" | "originalName">;
  onChange: (patch: Partial<Pick<CharacterNameSelection, "displayName" | "originalName">>) => void; disabled: boolean;
}) {
  return <div className="grid gap-3 sm:grid-cols-2">
    {([{ language: "zh", field: "displayName", label: "中文显示名" }, { language: "ja", field: "originalName", label: "日文显示名" }] as const).map(({ language, field, label }) => {
      const options = [...new Set([...characterNameOptions(character, language), selected[field]])].map((name) => ({ value: name, label: name }));
      return <div key={field}><Label>{label}</Label><SelectField aria-label={label} disabled={disabled} value={selected[field]} options={options} onValueChange={(value) => { if (value) onChange({ [field]: value }); }} /></div>;
    })}
  </div>;
}
function CharacterPicker({ characters, selected, onChange, disabled, excludeIds }: { characters: CharacterIndexEntry[]; selected: CharacterNameSelection[]; onChange: (values: CharacterNameSelection[]) => void; disabled: boolean; excludeIds: number[] }) {
  const [query, setQuery] = useState("");
  const results = characters.filter((character) => !excludeIds.includes(character.id) && !selected.some((item) => item.characterId === character.id) && characterNameKey([character.primaryName, character.originalName, ...character.aliases.map((alias) => alias.name)].join(" ")).includes(characterNameKey(query)));
  return <div className="grid gap-3">
    {selected.map((selection) => {
      const character = characters.find((item) => item.id === selection.characterId)!;
      return <div key={selection.characterId} className="grid gap-2 border-b border-border pb-3">
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{selection.displayName} · {selection.originalName}</span><Button aria-label={"取消选择" + selection.displayName} type="button" size="icon" variant="ghost" disabled={disabled} onClick={() => onChange(selected.filter((item) => item.characterId !== selection.characterId))}><X aria-hidden size={14} /></Button></div>
        <CharacterNameFields character={character} selected={selection} disabled={disabled} onChange={(patch) => onChange(selected.map((item) => item.characterId === selection.characterId ? { ...item, ...patch } : item))} />
      </div>;
    })}
    <Input aria-label="搜索要加入分类的角色" type="search" placeholder="输入中文名、日文名或别名" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} />
    <div className="max-h-48 overflow-y-auto rounded-md border border-border">
      {results.slice(0, 40).map((character) => <Button className="w-full justify-start gap-2 rounded-none border-b border-border/50 text-left text-sm font-normal last:border-b-0" key={character.id} type="button" variant="ghost" disabled={disabled || selected.length >= 100} onClick={() => onChange([...selected, characterMembershipNames(character)])}><Plus aria-hidden size={13} /><span>{character.primaryName}</span><span className="truncate text-xs text-muted">{character.originalName}</span></Button>)}
      {!results.length ? <EmptyState title="没有可添加的匹配角色" variant="plain" className="p-3 text-xs" /> : null}
    </div>
    {results.length > 40 ? <p className="text-xs text-muted">还有 {results.length - 40} 位，请输入名称缩小范围。</p> : null}
  </div>;
}
