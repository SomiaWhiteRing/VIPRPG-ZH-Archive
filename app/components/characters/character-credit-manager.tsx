import { Button } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { Checkbox } from "@/app/components/ui/checkbox";
import { CategoryPicker } from "@/app/components/characters/category-picker";
import { CharacterDragItem, CharacterLibraryDragItem, CharacterDragSlot, CharacterDropZone, characterCollisionDetection, characterKeyboardCoordinates, type CharacterDragSource, type CharacterDropTarget } from "@/app/components/ui/character-credit-drag";
import { DragSession, DragStack, DragLanding, captureDragPreview, captureDragStack, useDragOrigin, dragSortingStrategy, type DragPreview, type DragLandingState } from "@/app/components/ui/multi-drag";
import { SortableOverlay } from "@/app/components/ui/sortable-list-item";
import { DndContext, KeyboardSensor, MouseSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import * as Dialog from "@/app/components/ui/dialog";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import {
  characterMembershipKey,
  sortCharacterNodes,
  UNCLASSIFIED_GROUP_ID,
  type CharacterIndexData,
} from "@/lib/character-index";
import {
  CHARACTER_ROLE_LABELS,
  characterNameKey,
  type CharacterCreditSelection,
  type CharacterRoleKey,
  type CharacterSuggestion,
} from "@/lib/character-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { cn } from "@/lib/ui/cn";
import { Check, ChevronDown, ChevronRight, ListChecks, PanelsTopLeft, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

const ROLE_KEYS = Object.keys(CHARACTER_ROLE_LABELS) as CharacterRoleKey[];
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } };
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: characterKeyboardCoordinates };
type DragSelection =
  | { from: "library"; activeId: string; ids: number[] }
  | { from: "work"; activeIndex: number; indices: number[]; original: CharacterCreditSelection[] };
type CatalogItem = { character: CharacterSuggestion; name: string; originalName: string };
type SearchName = { name: string; key: string };
const creditIds = new WeakMap<CharacterCreditSelection["selection"], string>();
function creditDragId(credit: CharacterCreditSelection): string {
  let id = creditIds.get(credit.selection);
  if (!id) { id = `credit:${crypto.randomUUID()}`; creditIds.set(credit.selection, id); }
  return id;
}

export function CharacterCreditManager({
  id, disabled, characterIndex, suggestions, values, faceSheetFiles,
  onChange, onRestore, onCreate, onEditPortrait, renderPortrait,
}: {
  id: string;
  disabled: boolean;
  characterIndex: Pick<CharacterIndexData, "categories" | "memberships">;
  suggestions: CharacterSuggestion[];
  values: CharacterCreditSelection[];
  faceSheetFiles: Record<number, File[]>;
  onChange: (values: CharacterCreditSelection[], reorderedIndices?: number[]) => void;
  onRestore: (values: CharacterCreditSelection[], files: Record<number, File[]>) => void;
  onCreate: (query: string, role: CharacterRoleKey) => void;
  onEditPortrait: (index: number, trigger: HTMLButtonElement) => void;
  renderPortrait: (index: number) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [workQuery, setWorkQuery] = useState("");
  const [workSearchQuery, setWorkSearchQuery] = useState("");
  const searchComposing = useRef(false);
  const workSearchComposing = useRef(false);
  const [openRole, setOpenRole] = useState<CharacterRoleKey | null>(
    () => ROLE_KEYS.find((role) => values.some((credit) => credit.roleKey === role)) ?? "main",
  );
  const [multi, setMulti] = useState<"library" | "work" | null>(null);
  const [pickedLibrary, setPickedLibrary] = useState(new Set<number>());
  const [pickedWork, setPickedWork] = useState(new Set<number>());
  const [dragging, setDragging] = useState<DragSelection | null>(null);
  const drag = useRef<DragSelection | null>(null);
  const { origin: dragOrigin, measuring } = useDragOrigin();
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragStack = useRef<HTMLDivElement>(null);
  const [landing, setLanding] = useState<DragLandingState | null>(null);
  const [settlingIds, setSettlingIds] = useState(new Set<string>());
  const finishLanding = useCallback(() => { setLanding(null); setSettlingIds(new Set()); }, []);
  const resetDrag = useCallback(() => {
    drag.current = null; dragOrigin.current = null; setDragging(null); setDragPreview(null); setDropZone("");
    finishLanding();
  }, [finishLanding, dragOrigin]);
  const dndId = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );
  const [dropZone, setDropZone] = useState("");
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<{ values: CharacterCreditSelection[]; files: Record<number, File[]> } | null>(null);
  const expectedValues = useRef(values);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [nameValue, setNameValue] = useState("");
  const nameDraft = useRef<{ index: number; value: string } | null>(null);
  const composing = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const nameButtons = useRef(new Map<number, HTMLButtonElement>());
  const catalogScroll = useRef(0);
  const roleScrolls = useRef(new Map<CharacterRoleKey, number>());
  const catalogViewport = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const suggestionMap = useMemo(() => new Map(suggestions.map((item) => [item.id, item])), [suggestions]);
  const { categories, memberships } = characterIndex;
  const browseCategories = useMemo(() => [...categories, {
    id: UNCLASSIFIED_GROUP_ID, parentId: null, label: "未分类", originalName: null, sourceUrl: null, sortOrder: Number.MAX_SAFE_INTEGER,
  }], [categories]);
  const catalogIndex = useMemo(() => {
    const nodes = sortCharacterNodes([
      ...categories.map((item) => ({ id: item.id, parentId: item.parentId, sortOrder: item.sortOrder, member: null })),
      ...memberships.map((member) => ({ id: characterMembershipKey(member.categoryId, member.characterId), parentId: member.categoryId, sortOrder: member.sortOrder, member })),
    ]);
    const children = new Map<string | null, typeof nodes>();
    for (const node of nodes) {
      const siblings = children.get(node.parentId);
      if (siblings) siblings.push(node); else children.set(node.parentId, [node]);
    }
    const byId = new Map(categories.map((item) => [item.id, item]));
    const membersByCategory = new Map(categories.map((item) => [item.id, new Set<number>()]));
    const assigned = new Set(memberships.map((item) => item.characterId));
    // Each membership contributes only to its ancestors, instead of scanning all memberships for every category.
    for (const member of memberships) {
      if (!suggestionMap.has(member.characterId)) continue;
      const visited = new Set<string>();
      let categoryId: string | null = member.categoryId;
      while (categoryId && !visited.has(categoryId)) {
        visited.add(categoryId); membersByCategory.get(categoryId)?.add(member.characterId);
        categoryId = byId.get(categoryId)?.parentId ?? null;
      }
    }
    const unclassified = suggestions.filter((item) => !assigned.has(item.id)).map((character) => ({ character, name: character.primaryName, originalName: character.originalName }));
    const counts = new Map([...membersByCategory].map(([categoryId, members]) => [categoryId, members.size]));
    counts.set(UNCLASSIFIED_GROUP_ID, unclassified.length);
    return { children, counts, unclassified };
  }, [categories, memberships, suggestionMap, suggestions]);
  const searchNames = useMemo(() => new Map(suggestions.map((character) => [character.id,
    characterNames(character).map((name) => ({ name, key: characterNameKey(name) })),
  ])), [suggestions]);
  const catalog = useMemo<CatalogItem[]>(() => {
    const term = characterNameKey(searchQuery);
    if (term) return suggestions.flatMap((character) => {
      let rank = 3, name = character.primaryName;
      for (const entry of searchNames.get(character.id) ?? []) {
        const nextRank = entry.key === term ? 0 : entry.key.startsWith(term) ? 1 : entry.key.includes(term) ? 2 : 3;
        if (nextRank < rank) { rank = nextRank; name = entry.name; }
      }
      return rank < 3 ? [{ character, name, originalName: character.originalName, rank }] : [];
    }).sort((a, b) => a.rank - b.rank || b.character.workCount - a.character.workCount);
    if (!category) return [];
    if (category === UNCLASSIFIED_GROUP_ID) return catalogIndex.unclassified;
    // Match the category library's sibling order, then flatten each subtree in place.
    const names = new Map<number, CatalogItem>();
    const visited = new Set<string>();
    function collect(parentId: string) {
      if (visited.has(parentId)) return;
      visited.add(parentId);
      for (const node of catalogIndex.children.get(parentId) ?? []) {
        if (!node.member) { collect(node.id); continue; }
        const member = node.member, character = suggestionMap.get(member.characterId);
        if (!character || (names.has(character.id) && member.categoryId !== category)) continue;
        names.set(character.id, { character, name: member.displayName ?? character.primaryName, originalName: member.originalName ?? character.originalName });
      }
    }
    collect(category);
    return [...names.values()];
  }, [category, catalogIndex, searchNames, searchQuery, suggestionMap, suggestions]);
  const catalogById = useMemo(() => new Map(catalog.map((item) => [item.character.id, item])), [catalog]);
  const searchTerm = characterNameKey(searchQuery);
  const workTerm = characterNameKey(workSearchQuery);
  const workRows = useMemo(() => values.map((credit, index) => ({ credit, index })).filter(({ credit }) => matchesCredit(credit, workTerm, searchNames)), [values, workTerm, searchNames]);
  const workGroups = useMemo(() => {
    const groups = new Map(ROLE_KEYS.map((role) => [role, { total: 0, rows: [] as typeof workRows }]));
    for (const credit of values) groups.get(credit.roleKey)!.total += 1;
    for (const row of workRows) groups.get(row.credit.roleKey)!.rows.push(row);
    return groups;
  }, [values, workRows]);
  const dragSets = useMemo(() => ({
    work: new Set(dragging?.from === "work" ? dragging.indices : []),
    packed: new Set(dragging?.from === "work" ? dragging.indices.filter((index) => index !== dragging.activeIndex) : []),
    library: new Set(dragging?.from === "library" ? dragging.ids : []),
  }), [dragging]);
  const sortableIds = useMemo(() => new Map([...workGroups].map(([role, group]) => {
    const ids = group.rows.filter(({ index }) => !dragSets.packed.has(index)).map(({ credit }) => creditDragId(credit));
    // One held slot joins the existing sortable grid, regardless of batch size.
    if (dragging?.from === "library" && role === openRole) ids.push(dragging.activeId);
    return [role, ids];
  })), [workGroups, dragSets, dragging, openRole]);
  const pickedCounts = useMemo(() => new Map([...workGroups].map(([role, group]) => [role,
    group.rows.reduce((count, { index }) => count + Number(pickedWork.has(index)), 0),
  ])), [workGroups, pickedWork]);
  const pendingPortraits = useMemo(() => values.filter((credit) => !credit.portrait &&
    (credit.selection.kind === "new" || !suggestionMap.get(credit.selection.characterId)?.defaultPortrait),
  ).length, [values, suggestionMap]);

  useEffect(() => {
    // A change from the portrait editor or another form control supersedes this undo snapshot.
    if (values !== expectedValues.current) {
      setUndo(null); setPickedWork(new Set()); setSettlingIds(new Set()); setLanding(null);
      expectedValues.current = values;
    }
  }, [values]);
  useEffect(() => {
    if (editingIndex !== null) { nameInput.current?.focus({ preventScroll: true }); nameInput.current?.select(); }
  }, [editingIndex]);
  useLayoutEffect(() => {
    if (pendingScroll.current === null) return;
    const tile = content.current?.querySelector<HTMLElement>(`[data-credit-index="${pendingScroll.current}"]`);
    const viewport = tile?.closest<HTMLDivElement>("[data-role-viewport]");
    if (!tile || !viewport) { pendingScroll.current = null; return; }
    const bounds = tile.getBoundingClientRect(), frame = viewport.getBoundingClientRect();
    if (bounds.top < frame.top) viewport.scrollTop += bounds.top - frame.top - 5;
    else if (bounds.bottom > frame.bottom) viewport.scrollTop += bounds.bottom - frame.bottom + 5;
    pendingScroll.current = null;
  }, [open, openRole, values]);

  const change = useCallback((next: CharacterCreditSelection[], message: string, indices?: number[]) => {
    setUndo({ values, files: { ...faceSheetFiles } });
    expectedValues.current = next;
    onChange(next, indices);
    setNotice(message);
  }, [faceSheetFiles, onChange, values]);
  const finishName = useCallback((save = true, focus = false) => {
    const draft = nameDraft.current; nameDraft.current = null;
    if (!draft) return;
    composing.current = false; setEditingIndex(null);
    const credit = values[draft.index], displayName = normalizeEntityName(draft.value);
    if (save && !disabled && credit && displayName && displayName !== credit.selection.displayName) {
      const selection = { ...credit.selection, displayName };
      creditIds.set(selection, creditDragId(credit));
      change(values.map((item, index) => index === draft.index ? { ...item, selection } : item), "本作名称已更新");
    }
    if (focus) nameButtons.current.get(draft.index)?.focus({ preventScroll: true });
  }, [change, disabled, values]);
  const editName = useCallback((index: number) => {
    if (disabled || nameDraft.current?.index === index) return;
    finishName();
    nameDraft.current = { index, value: values[index].selection.displayName };
    setNameValue(nameDraft.current.value); setEditingIndex(index);
  }, [disabled, finishName, values]);
  const resetPicks = useCallback(() => { setPickedLibrary(new Set()); setPickedWork(new Set()); }, []);
  const selectLibrary = useCallback((characterId: number, multiple: boolean) => {
    if (disabled) return;
    if (multiple) {
      finishName(); setMulti("library");
      setPickedWork((current) => current.size ? new Set() : current);
    }
    setPickedLibrary((current) => togglePick(current, characterId, multiple));
  }, [disabled, finishName]);
  const selectWork = useCallback((index: number) => {
    if (disabled) return;
    finishName(); setMulti("work");
    setPickedLibrary((current) => current.size ? new Set() : current);
    setPickedWork((current) => togglePick(current, index, true));
  }, [disabled, finishName]);
  function toggleMulti(pane: "library" | "work") { finishName(); setMulti(multi === pane ? null : pane); resetPicks(); }
  function add(ids: number[], role: CharacterRoleKey, before?: number): CharacterCreditSelection[] {
    if (disabled) return [];
    const added = ids.flatMap((characterId) => {
      const character = suggestionMap.get(characterId); if (!character) return [];
      const item = catalogById.get(characterId);
      return [{ selection: { kind: "existing" as const, characterId, originalName: character.originalName, displayName: item?.name ?? character.primaryName }, roleKey: role, portrait: null, faceSheetBlobSha256s: [] }];
    });
    if (!added.length) return [];
    const at = before ?? values.length;
    const indices = values.map((_, index) => index);
    indices.splice(at, 0, ...added.map(() => -1));
    pendingScroll.current = at;
    change([...values.slice(0, at), ...added, ...values.slice(at)], `已添加 ${added.length} 项到${CHARACTER_ROLE_LABELS[role]}`, indices);
    setOpenRole(role); resetPicks();
    return added;
  }
  const remove = useCallback((indices: number[]) => {
    if (disabled || !indices.length) return;
    const picked = new Set(indices);
    const remaining = values.map((_, index) => index).filter((index) => !picked.has(index));
    change(remaining.map((index) => values[index]), `已移除 ${indices.length} 项关联`, remaining);
    resetPicks();
  }, [change, disabled, resetPicks, values]);
  function move(indices: number[], role: CharacterRoleKey, before?: number, after = false): boolean {
    if (disabled || !indices.length || (before !== undefined && indices.includes(before))) return false;
    indices = [...indices].sort((a, b) => a - b);
    const picked = new Set(indices);
    const order = values.map((_, index) => index).filter((index) => !picked.has(index));
    let at = before === undefined ? -1 : order.indexOf(before);
    if (at >= 0 && after) at += 1;
    if (at < 0) { const last = order.reduce((found, index, position) => values[index].roleKey === role ? position : found, -1); at = last < 0 ? order.length : last + 1; }
    order.splice(at, 0, ...indices);
    if (order.every((index, position) => index === position) && indices.every((index) => values[index].roleKey === role)) return false;
    pendingScroll.current = order.indexOf(indices[0]);
    change(order.map((index) => picked.has(index) ? { ...values[index], roleKey: role } : values[index]), `已移到${CHARACTER_ROLE_LABELS[role]}`, order);
    setOpenRole(role); resetPicks();
    return true;
  }
  function moveFirst() {
    let order = values.map((_, index) => index);
    for (const role of ROLE_KEYS) {
      const picked = order.filter((index) => pickedWork.has(index) && values[index].roleKey === role);
      if (!picked.length) continue;
      const pickedSet = new Set(picked);
      const rest = order.filter((index) => !pickedSet.has(index));
      const at = rest.findIndex((index) => values[index].roleKey === role);
      rest.splice(at < 0 ? rest.length : at, 0, ...picked); order = rest;
    }
    if (!order.every((index, position) => index === position)) change(order.map((index) => values[index]), "选中关联已置于各组最前", order);
    resetPicks();
  }
  function endDrag() { drag.current = null; dragOrigin.current = null; setDragging(null); setDragPreview(null); setDropZone(""); }
  function dragTargets(current: DragSelection): DragLandingState["targets"] {
    if (current.from === "library") return new Map(current.ids.map((id) => [`library:${id}`, { id: `library:${id}` }]));
    return new Map(current.indices.map((index) => {
      const credit = current.original[index], id = creditDragId(credit);
      return [id, { id, fallback: `role:${credit.roleKey}` }];
    }));
  }
  function land(snapshot: ReturnType<typeof captureDragStack>, targets: DragLandingState["targets"]) {
    if (!snapshot) { finishLanding(); return; }
    setSettlingIds(new Set([...targets.values()].map((target) => target.id)));
    setLanding({ snapshot, targets });
  }
  function cancelDrag() {
    const current = drag.current; if (!current) return;
    const snapshot = captureDragStack(dragStack.current, dragPreview), targets = dragTargets(current);
    endDrag(); land(snapshot, targets);
  }
  function startDrag({ active }: DragStartEvent) {
    if (disabled) return;
    const source = active.data.current as CharacterDragSource | undefined;
    if (!source) return;
    finishLanding();
    const selection: DragSelection = source.from === "library"
      ? { from: "library", activeId: String(active.id), ids: pickedLibrary.has(source.characterId) ? [...pickedLibrary] : [source.characterId] }
      : { from: "work", activeIndex: source.index, indices: pickedWork.has(source.index) ? [...pickedWork].sort((a, b) => a - b) : [source.index], original: values };
    const picked = selection.from === "library" ? selection.ids : selection.indices;
    const keys = new Map(picked.map((key) => [selection.from === "library" ? `library:${key}` : creditDragId(values[key]), key]));
    const captured = captureDragPreview(content.current, String(active.id), [...keys.keys()], (id) => {
      const key = keys.get(id)!;
      if (source.from === "work") return <><span className="size-7 shrink-0 overflow-hidden rounded-sm">{renderPortrait(key)}</span><span className="min-w-0 flex-1 truncate">{values[key].selection.displayName}</span></>;
      const character = suggestionMap.get(key); if (!character) return null;
      const name = catalogById.get(key)?.name ?? character.primaryName;
      return <><span className="size-7 shrink-0 overflow-hidden rounded-sm"><CharacterPortrait className="size-7 rounded-sm text-[11px]" displayName={name} portrait={character.defaultPortrait} size={28} toneKey={key} /></span><span className="min-w-0 flex-1 truncate">{name}</span></>;
    });
    dragOrigin.current = captured.origin;
    drag.current = selection; setDragging(selection); setDragPreview(captured.preview);
  }
  function drop({ over }: DragEndEvent) {
    const current = drag.current;
    if (!current) return;
    const target = over?.data.current as CharacterDropTarget | undefined;
    const snapshot = captureDragStack(dragStack.current, dragPreview), targets = dragTargets(current);
    endDrag();
    if (!disabled && target) {
      if (current.from === "library" && target.kind !== "remove") {
        for (const credit of add(current.ids, target.role, target.kind === "credit" ? target.index : undefined)) {
          if (credit.selection.kind === "existing") targets.set(`library:${credit.selection.characterId}`, { id: creditDragId(credit), fallback: `role:${target.role}` });
        }
      } else if (current.from === "work" && current.original.length === values.length && current.original.every((item, index) => item === values[index])) {
        if (target.kind === "remove") remove(current.indices);
        else {
          const picked = new Set(current.indices);
          const rows = workGroups.get(target.role)!.rows.filter(({ index }) => index === current.activeIndex || !picked.has(index));
          const from = rows.findIndex(({ index }) => index === current.activeIndex), to = target.kind === "credit" ? rows.findIndex(({ index }) => index === target.index) : -1;
          if (move(current.indices, target.role, target.kind === "credit" ? target.index : undefined, from >= 0 && to > from)) {
            for (const [id] of targets) targets.set(id, { id, fallback: `role:${target.role}` });
          }
        }
      }
    }
    if (target?.kind === "remove") finishLanding(); else land(snapshot, targets);
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0);
  }

  const nameEditor = useMemo(() => {
    if (editingIndex === null || !values[editingIndex]) return null;
    const index = editingIndex, credit = values[index], name = credit.selection.displayName;
    return <Input aria-label={`${name} 在本作中的名称`} className="h-[26px] min-w-0 flex-1 rounded-sm px-[3px] py-0 text-xs" disabled={disabled} maxLength={100} title={`${name} · ${credit.selection.originalName}`} ref={nameInput} value={nameValue}
      onChange={(event) => { setNameValue(event.target.value); if (nameDraft.current) nameDraft.current.value = event.target.value; }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; if (nameDraft.current) nameDraft.current.value = event.currentTarget.value; if (document.activeElement !== event.currentTarget) finishName(); }}
      onBlur={(event) => { if (!composing.current && event.relatedTarget !== nameButtons.current.get(index)) finishName(); }}
      onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return; if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishName(event.key === "Enter", true); } }} />;
  }, [editingIndex, values, disabled, nameValue, finishName]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      if (next && disabled) return;
      finishName(); resetDrag(); setOpen(next);
    }}>
      <Dialog.Trigger asChild>
        <Button className="hidden h-8 min-h-8 shrink-0 px-2.5 text-xs lg:inline-flex" disabled={disabled} size="sm" type="button" variant="outline">
          <PanelsTopLeft aria-hidden />角色管理器+
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          ref={content}
          id={`${id}-manager`}
          className="left-1/2 top-1/2 flex h-[680px] min-w-[1040px] w-[calc(min(1000px,100vw_-_3rem)_+_100px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg"
          onEscapeKeyDown={(event) => { if (nameDraft.current) { event.preventDefault(); if (!composing.current) finishName(false, true); } else if (drag.current) { event.preventDefault(); cancelDrag(); } }}
          onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <Dialog.Title className="text-base">管理登场角色</Dialog.Title>
            <span className="text-xs text-muted">{values.length} 项关联</span>
            <Dialog.Description className="sr-only">按类别或名称查找角色，拖入身份分组添加，拖回角色库移除。名称可原位编辑。</Dialog.Description>
            <Dialog.Close asChild><Button aria-label="关闭角色管理" className="ml-auto size-7 min-h-0 p-0" size="icon" type="button" variant="ghost"><X aria-hidden /></Button></Dialog.Close>
          </header>
          <DndContext id={dndId} sensors={sensors} measuring={measuring} collisionDetection={characterCollisionDetection}
            accessibility={{ screenReaderInstructions: { draggable: "按空格或 Enter 开始拖动，方向键移动，空格或 Enter 确认，Escape 取消。" } }}
            onDragStart={startDrag} onDragCancel={cancelDrag} onDragEnd={drop}
            onDragOver={({ over }) => {
              const target = over?.data.current as CharacterDropTarget | undefined;
              // Only the removal zone and collapsed headers display drag feedback.
              setDropZone(target?.kind === "remove" ? "remove" : target?.kind === "role" && target.role !== openRole ? target.role : "");
            }}>
          <DragSession dragging={Boolean(dragging)} onReset={resetDrag} />
          {/* Preserve the original left column width; the extra 100px belongs to the right column. */}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,calc((100%_-_101px)/2))_minmax(0,1fr)] gap-px bg-border">
            <CharacterDropZone id="remove" target={{ kind: "remove" }} disabled={disabled} aria-label="角色库" className="relative flex min-h-0 min-w-0 flex-col bg-card">
              <header className="flex shrink-0 items-center gap-2 px-3 py-2">
                <h3 className="text-sm font-semibold">角色库</h3><span className="text-xs text-muted">{suggestions.length} 个角色</span>
                <Button className="ml-auto min-h-7 px-1.5 text-xs" disabled={disabled || !openRole} size="sm" type="button" variant="ghost" onClick={() => openRole && onCreate(query, openRole)}><Plus aria-hidden />新增角色</Button>
                <Button aria-label="角色库多选" aria-pressed={multi === "library"} className="size-7 min-h-0 p-0" disabled={disabled} size="icon" title="多选" type="button" variant={multi === "library" ? "default" : "ghost"} onClick={() => toggleMulti("library")}><ListChecks aria-hidden /></Button>
              </header>
              <div className="grid shrink-0 gap-2 px-3 pb-2">
                <CategoryPicker id={`${id}-category`} mode="membership" disabled={disabled} categories={browseCategories} counts={catalogIndex.counts} emptyLabel="不选择分类" showHeader={false} triggerClassName="h-8 min-h-8 whitespace-nowrap py-0 text-xs [&>span:first-child]:truncate" value={category || null} onValueChange={(next) => {
                  setCategory(next ?? ""); setSearchQuery(""); setPickedLibrary(new Set()); catalogScroll.current = 0;
                  if (catalogViewport.current) catalogViewport.current.scrollTop = 0;
                }} />
                <div className="relative">
                  <Input aria-label="搜索全部角色" className="h-8 pr-7 text-xs" disabled={disabled} placeholder="输入中文名、日文名或别名以搜索" value={query} onChange={(event) => setQuery(event.target.value)}
                  onCompositionStart={() => { searchComposing.current = true; }} onCompositionEnd={() => { searchComposing.current = false; }} onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || searchComposing.current) return;
                    event.preventDefault(); event.stopPropagation();
                    setSearchQuery(query); setCategory(""); setPickedLibrary(new Set()); catalogScroll.current = 0;
                    if (catalogViewport.current) catalogViewport.current.scrollTop = 0;
                  }} />
                  {query || searchTerm ? <Button aria-label="清除角色搜索" className="absolute right-0 top-0 size-8 min-h-0 p-0" disabled={disabled} size="icon" type="button" variant="ghost" onClick={() => { setQuery(""); setSearchQuery(""); setPickedLibrary(new Set()); }}><X aria-hidden /></Button> : null}
                </div>
                {category || searchTerm || multi === "library" ? <div className="flex min-h-5 items-center gap-2 text-xs text-muted" aria-live="polite">
                  <span>{searchTerm ? `全库搜索 · ${catalog.length} 个角色` : category ? `${catalog.length} 个角色` : null}</span>
                  {multi === "library" ? <Button className="ml-auto min-h-5 px-1 text-xs" disabled={disabled || !catalog.length} size="sm" type="button" variant="ghost" onClick={() => setPickedLibrary(new Set(catalog.map((item) => item.character.id)))}>选择全部</Button> : null}
                </div> : null}
              </div>
              <div data-library-viewport data-drag-viewport className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 [scrollbar-gutter:stable]" ref={(node) => { catalogViewport.current = node; if (node) node.scrollTop = catalogScroll.current; }} onScroll={(event) => { catalogScroll.current = event.currentTarget.scrollTop; }}>
                <div className={cn("grid grid-cols-3 auto-rows-[38px] content-start gap-[5px]", settlingIds.size > 0 && "pointer-events-none")}>
                  {catalog.map((item) => <LibraryCharacterTile key={item.character.id} item={item} disabled={disabled} multiple={multi === "library"} selected={pickedLibrary.has(item.character.id)} lifted={dragSets.library.has(item.character.id)} settling={settlingIds.has(`library:${item.character.id}`)} onSelect={selectLibrary} />)}
                </div>
                {!catalog.length ? <EmptyState className="h-full content-center justify-items-center text-center" title={category || searchTerm ? "没有找到角色" : "选择分类或搜索"} variant="plain" /> : null}
              </div>
              <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{pickedLibrary.size ? `已选择 ${pickedLibrary.size} 个角色` : "未选择角色"}</span>
                {pickedLibrary.size ? <Button className="min-h-7 px-1 text-xs" disabled={disabled} size="sm" type="button" variant="ghost" onClick={() => setPickedLibrary(new Set())}>清空选择</Button> : null}
                <Button className="min-h-7 text-xs" disabled={disabled || !pickedLibrary.size || !openRole} size="sm" type="button" onClick={() => openRole && add([...pickedLibrary], openRole)}>{openRole ? `加入${CHARACTER_ROLE_LABELS[openRole]}` : "先展开身份分组"}</Button>
              </footer>
              {dragging?.from === "work" ? <div aria-hidden className={cn("pointer-events-none absolute inset-1 z-10 flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-border bg-card/95 text-sm", dropZone === "remove" && "border-destructive bg-destructive/10 text-destructive")}><Trash2 />从本作移除 {dragging.indices.length} 项关联</div> : null}
            </CharacterDropZone>
            <section aria-label="本作角色" className="flex min-h-0 min-w-0 flex-col bg-card">
              <header className="flex shrink-0 items-center gap-2 px-3 py-2">
                <h3 className="text-sm font-semibold">本作角色</h3><span className="text-xs text-muted">{values.length} 项</span>
                <Button aria-label="本作角色多选" aria-pressed={multi === "work"} className="ml-auto size-7 min-h-0 p-0" disabled={disabled} size="icon" title="多选" type="button" variant={multi === "work" ? "default" : "ghost"} onClick={() => toggleMulti("work")}><ListChecks aria-hidden /></Button>
              </header>
              <div className="grid shrink-0 gap-1 px-3 pb-2">
                <div className="relative"><Input aria-label="搜索本作角色" className="h-8 pr-7 text-xs" disabled={disabled} placeholder="搜索本作角色或登场名称" value={workQuery} onChange={(event) => setWorkQuery(event.target.value)}
                  onCompositionStart={() => { workSearchComposing.current = true; }} onCompositionEnd={() => { workSearchComposing.current = false; }} onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || workSearchComposing.current) return;
                    event.preventDefault(); event.stopPropagation();
                    setWorkSearchQuery(workQuery); setPickedWork(new Set()); roleScrolls.current.clear();
                    const term = characterNameKey(workQuery);
                    const match = term ? values.find((credit) => matchesCredit(credit, term, searchNames)) : undefined;
                    if (match) setOpenRole(match.roleKey);
                  }} />{workQuery || workTerm ? <Button aria-label="清除本作搜索" className="absolute right-0 top-0 size-8 min-h-0 p-0" disabled={disabled} size="icon" type="button" variant="ghost" onClick={() => { setWorkQuery(""); setWorkSearchQuery(""); setPickedWork(new Set()); }}><X aria-hidden /></Button> : null}</div>
                {workTerm ? <span className="text-xs text-muted" aria-live="polite">筛选结果 · {workRows.length} / {values.length} 项</span> : null}
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {ROLE_KEYS.map((role) => {
                  const { total, rows } = workGroups.get(role)!, expanded = openRole === role;
                  const pickedCount = pickedCounts.get(role)!;
                  const librarySlot = expanded && dragging?.from === "library" ? dragging.activeId : null;
                  return <CharacterDropZone key={role} id={`role:${role}`} target={{ kind: "role", role }} disabled={disabled} className={cn("flex min-h-0 flex-col border-t border-border", expanded ? "flex-1" : "shrink-0")}>
                    <h3 data-role-header={role} data-drag-fallback={`role:${role}`} className={cn("flex shrink-0 items-center gap-2 pr-3", expanded && "bg-primary/5", !expanded && dropZone === role && "ring-2 ring-inset ring-primary")}><Button aria-controls={`${id}-role-${role}`} aria-expanded={expanded} className="min-h-9 min-w-0 flex-1 justify-start gap-2 rounded-none px-3 py-1 text-xs"
                      disabled={disabled} type="button" variant="ghost" onClick={() => { finishName(); setOpenRole(expanded ? null : role); }}>
                      {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}<span className="flex flex-1 items-center gap-2 text-left"><span>{CHARACTER_ROLE_LABELS[role]}</span>{dragging && !expanded ? <span className="text-xs font-normal text-muted">移入此分组</span> : null}</span>
                    </Button>
                      {multi === "work" ? <Checkbox aria-label={`${CHARACTER_ROLE_LABELS[role]}全选或取消全选${workTerm ? "当前筛选结果" : ""}`} checked={pickedCount === 0 ? false : pickedCount === rows.length ? true : "indeterminate"} disabled={disabled || !rows.length} onCheckedChange={(checked) => {
                        setPickedWork((current) => {
                          const next = new Set(current);
                          for (const { index } of rows) { if (checked === true) next.add(index); else next.delete(index); }
                          return next;
                        });
                      }} /> : null}
                      <span className="rounded bg-muted/15 px-1.5 py-0.5 text-xs font-normal tabular-nums">{workTerm ? `${rows.length} / ` : ""}{total}</span>
                    </h3>
                    {expanded ? <div aria-label={`${CHARACTER_ROLE_LABELS[role]}角色区域`} data-role-viewport data-drag-viewport className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [scrollbar-gutter:stable]" id={`${id}-role-${role}`}
                      ref={(node) => { if (node) node.scrollTop = roleScrolls.current.get(role) ?? 0; }} onScroll={(event) => { roleScrolls.current.set(role, event.currentTarget.scrollTop); }}>
                      <SortableContext id={`${id}-role-${role}`} items={sortableIds.get(role)!} strategy={dragSortingStrategy}>
                      <div className={cn("grid grid-cols-3 auto-rows-[38px] content-start gap-[5px]", settlingIds.size > 0 && "pointer-events-none")}>
                        {rows.map(({ credit, index }) => {
                          const selected = pickedWork.has(index), name = credit.selection.displayName;
                          return <CharacterDragItem key={creditDragId(credit)} id={creditDragId(credit)} source={{ from: "work", index }} target={{ kind: "credit", role, index }} disabled={disabled} packed={dragSets.packed.has(index)} lifted={dragSets.work.has(index)} settling={settlingIds.has(creditDragId(credit))} activateFromContainer data-credit-index={index} role="group" aria-label={`${name}，${CHARACTER_ROLE_LABELS[role]}`}
                            className={cn("relative flex h-[38px] w-full min-w-0 cursor-grab items-center gap-1.5 rounded border border-border px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing [content-visibility:auto] [contain-intrinsic-size:38px]", selected && "border-primary bg-primary/5 ring-1 ring-primary")}
                            onClickCapture={(event) => {
                              if (disabled || !event.ctrlKey || (event.target as Element).closest("input, textarea, [data-drag-no-activate]")) return;
                              event.preventDefault(); event.stopPropagation(); selectWork(index);
                            }}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Delete") { event.preventDefault(); remove(selected ? [...pickedWork] : [index]); }
                              if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); const next = ROLE_KEYS[ROLE_KEYS.indexOf(role) + (event.key === "ArrowLeft" ? -1 : 1)]; if (next) move([index], next); }
                              if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); const group = values.map((item, i) => ({ item, i })).filter(({ item }) => item.roleKey === role); const position = group.findIndex(({ i }) => i === index), other = group[position + (event.key === "ArrowUp" ? -1 : 1)]; if (other) { const order = values.map((_, i) => i); [order[index], order[other.i]] = [order[other.i], order[index]]; change(order.map((i) => values[i]), "组内顺序已更新", order); resetPicks(); } }
                            }}>
                            <WorkCharacterContent index={index} credit={credit} selected={selected} multiple={multi === "work"} disabled={disabled}
                              missing={!credit.portrait && (credit.selection.kind === "new" || !suggestionMap.get(credit.selection.characterId)?.defaultPortrait)}
                              portraitDialogId={`${id}-portrait-dialog`} editor={editingIndex === index ? nameEditor : null} nameButtons={nameButtons}
                              renderPortrait={renderPortrait} onEditPortrait={onEditPortrait} onEditName={editName} onFinishName={finishName} onSelect={selectWork} onRemove={remove} />
                          </CharacterDragItem>;
                        })}
                        {librarySlot ? <CharacterDragSlot id={librarySlot} role={role} disabled={disabled} /> : null}
                      </div>
                      </SortableContext>
                      {!rows.length && !librarySlot ? <EmptyState title={workTerm && total ? "没有符合筛选的关联" : `尚无${CHARACTER_ROLE_LABELS[role]}关联`} variant="plain" /> : null}
                    </div> : null}
                  </CharacterDropZone>;
                })}
              </div>
              <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-3 py-2">
                <span className="flex-1 text-xs text-muted">{pickedWork.size ? `已选择 ${pickedWork.size} 项` : openRole ? `${CHARACTER_ROLE_LABELS[openRole]} · ${workGroups.get(openRole)!.total} 项` : "未展开分组"}</span>
                {pickedWork.size ? <>
                  <Button className="min-h-7 px-1 text-xs" disabled={disabled} size="sm" type="button" variant="ghost" onClick={() => setPickedWork(new Set())}>清空选择</Button>
                  <Button className="min-h-7 px-1 text-xs" disabled={disabled} size="sm" type="button" variant="outline" onClick={moveFirst}>置于最前</Button>
                  <Button className="min-h-7 px-1 text-xs text-destructive" disabled={disabled} size="sm" type="button" variant="ghost" onClick={() => remove([...pickedWork])}>移除</Button>
                  <div className="flex basis-full gap-1">{ROLE_KEYS.map((role) => <Button key={role} className="min-h-7 px-1.5 text-xs" disabled={disabled} size="sm" type="button" variant="outline" onClick={() => move([...pickedWork], role)}>移到{CHARACTER_ROLE_LABELS[role]}</Button>)}</div>
                </> : null}
              </footer>
            </section>
          </div>
          <footer className="flex min-h-9 shrink-0 items-center gap-2 border-t border-border px-3 py-1 text-xs text-muted">
            <span role="status" aria-live="polite" className={cn(!notice && pendingPortraits > 0 && "text-destructive")}>{notice || (pendingPortraits ? `${pendingPortraits} 项待选头像` : "")}</span>
            {undo ? <Button className="ml-auto min-h-7 px-1.5 text-xs" disabled={disabled} size="sm" type="button" variant="ghost" onClick={() => {
              finishName(false); expectedValues.current = undo.values; onRestore(undo.values, undo.files); setUndo(null); resetPicks(); setNotice("已撤销上次修改");
            }}><Undo2 aria-hidden />撤销</Button> : null}
          </footer>
          <SortableOverlay>{dragPreview ? <DragStack {...dragPreview} className="h-[38px] w-full" itemClassName="flex items-center gap-1.5 px-1.5 text-xs" elementRef={dragStack} /> : null}</SortableOverlay>
          {landing ? <DragLanding landing={landing} container={content} onFinish={finishLanding} itemClassName="flex items-center gap-1.5 px-1.5 text-xs" /> : null}
          </DndContext>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function togglePick(current: Set<number>, id: number, multiple: boolean): Set<number> {
  const next = multiple ? new Set(current) : new Set<number>();
  if (current.has(id)) next.delete(id); else next.add(id);
  return next;
}
const WorkCharacterContent = memo(function WorkCharacterContent({ index, credit, selected, multiple, disabled, missing, portraitDialogId, editor, nameButtons, renderPortrait, onEditPortrait, onEditName, onFinishName, onSelect, onRemove }: {
  index: number; credit: CharacterCreditSelection; selected: boolean; multiple: boolean; disabled: boolean; missing: boolean; portraitDialogId: string;
  editor: ReactNode; nameButtons: RefObject<Map<number, HTMLButtonElement>>;
  renderPortrait: (index: number) => ReactNode; onEditPortrait: (index: number, trigger: HTMLButtonElement) => void; onEditName: (index: number) => void;
  onFinishName: (save: boolean, focus: boolean) => void; onSelect: (index: number) => void; onRemove: (indices: number[]) => void;
}) {
  const name = credit.selection.displayName;
  const portrait = useMemo(() => renderPortrait(index), [renderPortrait, index]);
  return <>
    <Button aria-label={`选择 ${name} 的头像`} aria-haspopup="dialog" aria-controls={portraitDialogId} className={cn("group/portrait relative size-7 min-h-0 shrink-0 overflow-hidden rounded-sm p-0 hover:bg-transparent", missing && "bg-destructive/10")} disabled={disabled} size="icon" title={missing ? `${name} · 待选头像` : `${name} · 选择本作头像`} type="button" variant="ghost" onClick={(event) => onEditPortrait(index, event.currentTarget)}>
      {portrait}<span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition-opacity group-hover/portrait:opacity-100 group-focus-visible/portrait:opacity-100 motion-reduce:transition-none"><Pencil className="size-3.5" /></span>
    </Button>
    <div className="flex min-w-0 flex-1 items-center gap-[3px]">
      {editor ?? (multiple ? <Button aria-label={`选择 ${name}`} aria-pressed={selected} className="h-[26px] min-h-0 min-w-0 flex-1 cursor-grab justify-start overflow-hidden rounded-none p-0 text-xs font-normal hover:bg-transparent active:cursor-grabbing" disabled={disabled} title={`${name} · ${credit.selection.originalName}`} type="button" variant="ghost" onClick={() => onSelect(index)}><span className="truncate">{name}</span></Button>
        : <span className="min-w-0 flex-1 truncate text-xs" title={`${name} · ${credit.selection.originalName}`}>{name}</span>)}
      <Button aria-label={editor ? "保存名称" : `编辑 ${name} 的名称`} data-drag-no-activate className="h-4 min-h-0 w-3.5 shrink-0 rounded-none p-0 text-muted [&_svg]:size-3" disabled={disabled} size="icon" title={editor ? "保存名称" : "编辑名称"} type="button" variant="ghost" ref={(node) => { if (node) nameButtons.current.set(index, node); else nameButtons.current.delete(index); }} onClick={() => editor ? onFinishName(true, true) : onEditName(index)}>{editor ? <Check aria-hidden /> : <Pencil aria-hidden />}</Button>
      <Button aria-label={`删除 ${name} 的关联`} data-drag-no-activate className="h-4 min-h-0 w-3.5 shrink-0 rounded-none p-0 text-muted hover:text-destructive [&_svg]:size-3" disabled={disabled} size="icon" title="删除关联" type="button" variant="ghost" onClick={() => onRemove([index])}><Trash2 aria-hidden /></Button>
    </div>
    {multiple ? <Checkbox aria-label={`选择 ${name}`} data-drag-no-activate checked={selected} className="absolute left-6 top-[23px] z-10 size-3 [&_svg]:size-2.5" disabled={disabled} onCheckedChange={() => onSelect(index)} /> : null}
  </>;
});
const LibraryCharacterTile = memo(function LibraryCharacterTile({ item, disabled, multiple, selected, lifted, settling, onSelect }: {
  item: CatalogItem; disabled: boolean; multiple: boolean; selected: boolean; lifted: boolean; settling: boolean; onSelect: (characterId: number, multiple: boolean) => void;
}) {
  return <CharacterLibraryDragItem id={`library:${item.character.id}`} source={{ from: "library", characterId: item.character.id }} disabled={disabled} lifted={lifted} settling={settling} className="h-[38px] min-w-0 [content-visibility:auto] [contain-intrinsic-size:38px]" data-library-character={item.character.id}>
    {({ attributes, listeners, setActivatorNodeRef }) => <Button {...attributes} {...listeners} ref={setActivatorNodeRef} aria-label={`${item.name} · ${item.originalName}`} aria-pressed={selected}
      className={cn("relative h-[38px] min-h-0 w-full min-w-0 cursor-grab justify-start gap-1.5 rounded border border-border px-1.5 py-0 text-xs font-normal hover:border-primary active:cursor-grabbing", selected && "border-primary bg-primary/5 ring-1 ring-primary")}
      disabled={disabled} type="button" variant="ghost" title={`${item.name} · ${item.originalName}`} onClick={(event) => onSelect(item.character.id, multiple || event.ctrlKey)}>
      <CharacterPortrait className="size-7 rounded-sm text-[11px]" displayName={item.name} portrait={item.character.defaultPortrait} size={28} toneKey={item.character.id} />
      <span className="min-w-0 flex-1 truncate text-left">{item.name}</span>
      {selected ? <Check aria-hidden className="pointer-events-none absolute left-6 top-[23px] size-2.5 rounded-full bg-primary text-primary-foreground" /> : null}
    </Button>}
  </CharacterLibraryDragItem>;
});

function characterNames(character: CharacterSuggestion): string[] {
  return [character.primaryName, character.originalName, ...character.aliases.map((item) => item.name)];
}
function matchesCredit(credit: CharacterCreditSelection, query: string, names: Map<number, SearchName[]>): boolean {
  return !query || characterNameKey(credit.selection.displayName).includes(query) ||
    (credit.selection.kind === "existing"
      ? Boolean(names.get(credit.selection.characterId)?.some((entry) => entry.key.includes(query)))
      : characterNameKey(credit.selection.originalName).includes(query) || characterNameKey(credit.selection.primaryName).includes(query));
}
