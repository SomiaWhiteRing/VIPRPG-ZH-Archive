import { useCallback, useEffect, useId, useLayoutEffect, useMemo, memo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ListChecks,
  ListX,
  FolderCog,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { DndContext, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, pointerWithin, type CollisionDetection, type KeyboardCoordinateGetter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { EmojiDropZone, EmojiSortable, EmojiDragSlot, emojiDragId } from "@/app/components/ui/emoji-drag";
import { DragSession, DragStack, DragLanding, captureDragPreview, captureDragStack, useDragOrigin, dragSortingStrategy, closestDragCenter, dragKeyboardCoordinates, type DragPreview, type DragLandingState } from "@/app/components/ui/multi-drag";
import { SortableOverlay } from "@/app/components/ui/sortable-list-item";
import { useToast } from "@/app/components/ui/toast";
import { cn } from "@/lib/ui/cn";
import {
  emojiCellKey,
  emojiInGroup,
  type FaceEmoji,
  type EmojiCharacter,
  type EmojiSheet,
  type EmojiGroup,
  type EmojiLibraryData,
  type EmojiGroupMembershipEdit,
} from "@/lib/face-emojis";
import { emojiCells, emojiRequest } from "./client";
import { FaceEmojiImage } from "@/app/components/ui/face-emoji-image";
import { EmojiSourcePicker } from "./source-picker";
import { SourceFaces, sourceKey, type EmojiSource } from "./source-faces";
import { EmojiGroupTabs } from "./group-tabs";
import { EmojiGroupManager } from "./group-manager";
import { EmojiGroupEditor } from "./group-editor";
import { useEmojiGroupSelection } from "./group-selection";

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "表情操作失败。";
type EmojiDrag = {
  activeId: string;
  emoji: FaceEmoji;
  emojis: FaceEmoji[];
  from: "source" | "library";
  order: FaceEmoji[];
  groupId: number | null;
};
const MOUSE_OPTIONS = { activationConstraint: { distance: 8 } };
const TOUCH_OPTIONS = { activationConstraint: { delay: 280, tolerance: 8 } };
const collisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const hits = pointerWithin(args);
    const groups = hits.filter((hit) => hit.data?.droppableContainer.data.current?.groupId !== undefined);
    if (groups.length) return groups;
    if (hits.some((hit) => hit.id === "source")) return hits.filter((hit) => hit.id === "source");
    if (!hits.some((hit) => hit.id === "library")) return [];
    // New favorites are inserted at the front by the collection API.
    const slot = args.active.data.current?.from === "source" && args.droppableContainers.find((item) => item.id === args.active.id && item.data.current?.slot);
    if (slot) return [{ id: slot.id }];
    const cells = args.droppableContainers.filter((item) => item.data.current?.from === "library");
    return cells.length ? closestDragCenter({ ...args, droppableContainers: cells }) : hits.filter((hit) => hit.id === "library");
  }
  const cells = args.droppableContainers.some((item) => item.data.current?.from === "library");
  return closestDragCenter({ ...args, droppableContainers: args.droppableContainers.filter((item) => item.id !== "library" || !cells) });
};
const emojiKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const cells = args.context.droppableContainers.getEnabled().some((item) => item.data.current?.from === "library");
  return dragKeyboardCoordinates(event, args, (item) => item.id !== "library" || !cells);
};
const KEYBOARD_OPTIONS = { coordinateGetter: emojiKeyboardCoordinates };

export function EmojiLibrary({
  admin = false,
  initialCharacter,
  initialSheet,
}: {
  admin?: boolean;
  initialCharacter?: EmojiCharacter;
  initialSheet?: EmojiSheet;
}) {
  const [source, setSource] = useState<EmojiSource>(() =>
    initialCharacter
      ? {
          kind: "character",
          character: initialCharacter,
          focus: initialSheet?.blobSha256,
        }
      : initialSheet
        ? { kind: "sheet", sheet: initialSheet }
        : { kind: "hot" },
  );
  const [mine, setMine] = useState<FaceEmoji[]>([]);
  const [groups, setGroups] = useState<EmojiGroup[]>([]);
  const { groupId, selectGroup, syncGroups } = useEmojiGroupSelection();
  const [manageGroups, setManageGroups] = useState(false);
  const [editingGroups, setEditingGroups] = useState<FaceEmoji[] | null>(null);
  const groupRef = useRef(groupId);
  groupRef.current = groupId;
  const groupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mineViewport = useRef<HTMLDivElement>(null);
  const groupScroll = useRef(new Map<number | null, number>());
  const applyLibraryData = useCallback((data: EmojiLibraryData) => {
    setMine(data.emojis);
    setGroups(data.groups);
    syncGroups(data);
  }, [syncGroups]);
  const [defaults, setDefaults] = useState<FaceEmoji[]>([]);
  const [active, setActive] = useState<FaceEmoji | null>(null);
  const [activeFrom, setActiveFrom] = useState<EmojiDrag["from"]>("source");
  const [multiSelect, setMultiSelect] = useState<EmojiDrag["from"] | null>(null);
  const [selected, setSelected] = useState<FaceEmoji[]>([]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [locateVersion, setLocateVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [ready, setReady] = useState(false);
  const toast = useToast();
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [drag, setDrag] = useState<EmojiDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<"source" | null>(
    null,
  );
  const dragRef = useRef<EmojiDrag | null>(null);
  const { origin: dragOrigin, measuring } = useDragOrigin();
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragStack = useRef<HTMLDivElement>(null);
  const [landing, setLanding] = useState<DragLandingState | null>(null);
  const [landingPending, setLandingPending] = useState(false);
  const [settling, setSettling] = useState(new Set<string>());
  const suppressClick = useRef(false);
  const finishLanding = useCallback(() => { setLanding(null); setLandingPending(false); setSettling(new Set()); }, []);
  const dndId = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_OPTIONS),
    useSensor(TouchSensor, TOUCH_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_OPTIONS),
  );
  const mutation = useRef(false);
  const workbench = useRef<HTMLDivElement>(null);
  const previewBar = useRef<HTMLDivElement>(null);
  const mineByCell = useMemo(() => new Map(mine.map((emoji) => [emojiCellKey(emoji), emoji])), [mine]);
  const visibleMine = useMemo(() => admin ? mine : mine.filter((emoji) => emojiInGroup(emoji, groupId)), [admin, mine, groupId]);
  const owned = useMemo(() => new Set(visibleMine.map(emojiCellKey)), [visibleMine]);
  function needsAddition(emoji: FaceEmoji, targetGroup: number | null) {
    const favorite = mineByCell.get(emojiCellKey(emoji));
    return !favorite || !emojiInGroup(favorite, targetGroup);
  }
  function hasAddition(emojis: FaceEmoji[], targetGroup: number | null) {
    return emojis.some((emoji) => (emoji.available || mineByCell.has(emojiCellKey(emoji))) && needsAddition(emoji, targetGroup));
  }
  const selectedKeys = useMemo(() => new Set(selected.map(emojiCellKey)), [selected]);
  const dragKeys = useMemo(() => new Set(drag?.emojis.map(emojiCellKey) ?? []), [drag]);
  const packed = useMemo(() => new Set(drag?.from === "library" ? drag.emojis.filter((emoji) => emojiCellKey(emoji) !== emojiCellKey(drag.emoji)).map(emojiCellKey) : []), [drag]);
  const sourceLifted = useMemo(() => drag?.from === "source" ? dragKeys : new Set<string>(), [drag, dragKeys]);
  const slotId = drag && (drag.from === "source" ? drag.emojis.some((emoji) => !owned.has(emojiCellKey(emoji))) : !owned.has(emojiCellKey(drag.emoji))) ? drag.activeId : null;
  const sortableIds = useMemo(() => {
    const ids = visibleMine.filter((emoji) => !packed.has(emojiCellKey(emoji))).map((emoji) => emojiDragId("library", emoji));
    if (slotId) { if (drag?.from === "source" && !admin) ids.unshift(slotId); else ids.push(slotId); }
    return ids;
  }, [visibleMine, packed, slotId, drag, admin]);
  const hasSelection = selected.length > 0;
  const canAddSelection = selected.some(
    (emoji) => emoji.available && needsAddition(emoji, groupId),
  );
  const activeKey = active ? emojiCellKey(active) : null;
  const activeIndex = mine.findIndex(
    (emoji) => emojiCellKey(emoji) === activeKey,
  );
  const isRemoval = hasSelection ? multiSelect === "library" : activeIndex >= 0 && (admin || activeFrom === "library");
  const preview = selected.at(-1) ?? mine[activeIndex] ?? active;
  const hasPreview = !!preview;
  const character = source.kind === "character" ? source.character : undefined;
  const sourceLabel =
    source.kind === "hot" ? "全站热门" : (character?.name ?? "所选脸图");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const result = await emojiRequest<EmojiLibraryData>(
        admin ? "/api/admin/emojis" : "/api/emojis",
        admin ? undefined : { op: "initialize" },
        controller.signal,
      );
      const recommendations = await emojiRequest<{ emojis: FaceEmoji[] }>(
        "/api/emojis?op=defaults",
        undefined,
        controller.signal,
      );
      setMine(result.emojis);
      if (!admin) { setGroups(result.groups); syncGroups(result, true); }
      setDefaults(recommendations.emojis);
      setReady(true);
      setLoadError("");
    })().catch((error) => {
      if (!controller.signal.aborted) setLoadError(failure(error));
    });
    return () => controller.abort();
  }, [admin, retry, syncGroups]);
  useLayoutEffect(() => {
    if (mineViewport.current) mineViewport.current.scrollTop = groupScroll.current.get(groupId) ?? 0;
  }, [groupId]);
  useEffect(() => () => { if (groupTimer.current) clearTimeout(groupTimer.current); }, []);
  function chooseGroup(id: number | null, duringDrag = false) {
    if (mineViewport.current) groupScroll.current.set(groupRef.current, mineViewport.current.scrollTop);
    selectGroup(id);
    if (!duringDrag) { setSelected([]); setActive(null); }
  }

  // Reserve the fixed mobile preview's actual height, including safe-area padding.
  useEffect(() => {
    const root = workbench.current,
      bar = previewBar.current;
    if (!hasPreview || !root || !bar) return;
    const measure = () =>
      root.style.setProperty(
        "--emoji-preview-height",
        `${bar.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--emoji-preview-height");
    };
  }, [hasPreview]);

  const update = useCallback(async function update(
    action: () => Promise<void>,
    { showBusy = true } = {},
  ) {
    if (mutation.current) {
      toast.info("正在保存，请稍后再操作。");
      return false;
    }
    mutation.current = true;
    if (showBusy) setBusy(true);
    else setSavingOrder(true);
    try {
      await action();
      return true;
    } catch (error) {
      toast.error(failure(error));
      return false;
    } finally {
      mutation.current = false;
      if (showBusy) setBusy(false);
      else setSavingOrder(false);
    }
  }, [toast]);
  function toggleMultiSelect(from: EmojiDrag["from"]) {
    setMultiSelect((current) => (current === from ? null : from));
    setSelected([]);
    if (from === "source") setActive(null);
  }
  async function changeCollection() {
    if (!preview || busy || !ready) return;
    const emojis = hasSelection ? selected : [preview];
    if (isRemoval) await remove(emojis);
    else await add(emojis, groupId);
  }
  async function add(emojis: FaceEmoji[], targetGroup: number | null) {
    if (busy || !ready) return false;
    const additions = emojis.filter(
      (emoji) => emoji.available && needsAddition(emoji, targetGroup),
    );
    if (!additions.length) return true;
    if (admin) {
      if (mine.length + additions.length > 256) {
        toast.error("默认清单最多保留 256 个表情。");
        return false;
      }
      setMine((current) => [...current, ...additions]);
      setSelected([]);
      setDirty(true);
      return true;
    }
    return update(async () => {
      const result = await emojiRequest<EmojiLibraryData>(
        "/api/emojis",
        { op: "add", cells: emojiCells(additions), groupId: targetGroup },
      );
      applyLibraryData(result);
      setSelected([]);
      setActive((current) =>
        current
          ? (result.emojis.find(
              (item) => emojiCellKey(item) === emojiCellKey(current),
            ) ?? current)
          : current,
      );
    });
  }
  async function moveToGroup(emojis: FaceEmoji[], fromGroup: number | null, targetGroup: number | null) {
    if (busy || !ready || !emojis.length) return false;
    if (fromGroup === targetGroup) return true;
    const transfers = emojis.flatMap((emoji) => {
      const favorite = mineByCell.get(emojiCellKey(emoji));
      return favorite && (fromGroup === null ? needsAddition(favorite, targetGroup) : emojiInGroup(favorite, fromGroup)) ? [favorite] : [];
    });
    if (!transfers.length) return true;
    return update(async () => {
      const result = await emojiRequest<EmojiLibraryData>("/api/emojis", {
        ids: transfers.map((emoji) => emoji.id),
        ...(fromGroup === null
          ? { op: "group.add", groupId: targetGroup }
          : { op: "groups.update", includeGroupIds: targetGroup === null ? [] : [targetGroup], excludeGroupIds: [fromGroup] }),
      });
      applyLibraryData(result);
      selectGroup(targetGroup);
      setSelected([]);
      setActive((current) => result.emojis.find((emoji) => emoji.id === current?.id) ?? current);
    });
  }
  async function createGroup() {
    await update(async () => {
      const result = await emojiRequest<EmojiLibraryData & { createdGroupId: number }>("/api/emojis", { op: "group.create" });
      applyLibraryData(result);
      chooseGroup(result.createdGroupId);
    });
  }
  async function editGroups(edit: EmojiGroupMembershipEdit) {
    if (!editingGroups?.length || busy || !ready) return false;
    return update(async () => {
      const result = await emojiRequest<EmojiLibraryData>("/api/emojis", { op: "groups.update", ids: editingGroups.map((emoji) => emoji.id), ...edit });
      applyLibraryData(result);
      const visibleGroup = groupId === null || result.groups.some((group) => group.id === groupId) ? groupId : null;
      const updated = new Map(result.emojis.map((emoji) => [emojiCellKey(emoji), emoji]));
      setSelected((current) => current.flatMap((emoji) => {
        const next = updated.get(emojiCellKey(emoji));
        return next && emojiInGroup(next, visibleGroup) ? [next] : [];
      }));
      setActive((current) => {
        const next = current ? updated.get(emojiCellKey(current)) : null;
        return next && emojiInGroup(next, visibleGroup) ? next : null;
      });
    });
  }
  const remove = useCallback(async function remove(emojis: FaceEmoji[], fromGroup: number | null = null) {
    if (busy || !ready || !emojis.length) return false;
    const removals = emojis.flatMap((emoji) => {
      const favorite = mineByCell.get(emojiCellKey(emoji));
      return favorite ? [favorite] : [];
    });
    if (!removals.length) return true;
    const keys = new Set(removals.map(emojiCellKey));
    if (admin) {
      setMine((current) =>
        current.filter((item) => !keys.has(emojiCellKey(item))),
      );
      setSelected((current) =>
        current.filter((item) => !keys.has(emojiCellKey(item))),
      );
      setDirty(true);
      return true;
    }
    return update(async () => {
      const result = await emojiRequest<EmojiLibraryData>(
        "/api/emojis",
        { op: "remove", ids: removals.map((emoji) => emoji.id), groupId: fromGroup },
      );
      applyLibraryData(result);
      setSelected((current) =>
        current.filter((item) => !keys.has(emojiCellKey(item))),
      );
      setActive((current) => current && keys.has(emojiCellKey(current)) ? null : current);
    });
  }, [busy, ready, mineByCell, admin, update, applyLibraryData]);
  const endDrag = useCallback(function endDrag() {
    if (groupTimer.current) clearTimeout(groupTimer.current);
    groupTimer.current = null;
    dragRef.current = null; dragOrigin.current = null; setDragPreview(null);
    setDrag(null);
    setDropTarget(null);
  }, [dragOrigin]);
  async function reorder(value: EmojiDrag) {
    if (mutation.current) return false;
    const next = value.order;
    if (
      next.every(
        (emoji, index) => emojiCellKey(emoji) === emojiCellKey(mine[index]),
      )
    )
      return true;
    const previous = mine;
    setMine(next);
    if (admin) {
      setDirty(true); setSelected([]);
      return true;
    }
    const keys = new Set(value.emojis.map(emojiCellKey));
    const index = next.reduce((last, emoji, index) => keys.has(emojiCellKey(emoji)) ? index : last, -1);
    // The optimistic order is already visible; saving it must not dim the gallery.
    const saved = await update(
      async () => {
        try {
          const result = await emojiRequest<EmojiLibraryData>(
            "/api/emojis",
            {
              op: "reorder",
              ids: value.emojis.map((emoji) => emoji.id),
              beforeId: next[index + 1]?.id ?? null,
            },
          );
          applyLibraryData(result);
        } catch (error) {
          setMine(previous);
          throw error;
        }
      },
      { showBusy: false },
    );
    if (saved) setSelected([]);
    return saved;
  }
  const locate = useCallback(function locate(emoji: FaceEmoji, preferred?: number) {
    setSelected([]);
    setActive(emoji);
    setLocateVersion((current) => current + 1);
    const related =
      emoji.sources.find((item) => item.id === (preferred ?? character?.id)) ??
      emoji.sources[0];
    if (related) {
      setSource({
        kind: "character",
        character:
          character && related.id === character.id
            ? character
            : { ...related, originalName: related.name },
        focus: emoji.blobSha256,
      });
      if (!emoji.available) toast.info("表情不可用");
    } else if (emoji.available) {
      setSource({
        kind: "sheet",
        sheet: {
          id: 0,
          blobSha256: emoji.blobSha256,
          width: emoji.width,
          height: emoji.height,
        },
      });
    } else toast.info("表情不可用");
  }, [character, toast]);
  const select = useCallback((emoji: FaceEmoji, from: EmojiDrag["from"], additive = false) => {
    if (multiSelect === from || additive) {
      const key = emojiCellKey(emoji);
      const current = multiSelect === from ? selectedRef.current : multiSelect === null && activeFrom === from && active ? [active] : [];
      if (additive) setMultiSelect(from);
      if (from === "source") setActive(null);
      if (current.some((item) => emojiCellKey(item) === key)) setSelected(current.filter((item) => emojiCellKey(item) !== key));
      else if (current.length >= 256) toast.info("每次最多选择 256 个表情。");
      else setSelected([...current, emoji]);
      return;
    }
    setActiveFrom(from);
    if (from === "library") { locate(emoji); return; }
    setSelected([]); setActive(mineByCell.get(emojiCellKey(emoji)) ?? emoji);
  }, [multiSelect, activeFrom, active, toast, locate, mineByCell]);
  const selectSource = useCallback((emoji: FaceEmoji, additive = false) => select(emoji, "source", additive), [select]);
  const selectLibrary = useCallback((emoji: FaceEmoji, additive = false) => select(emoji, "library", additive), [select]);
  const removeLibrary = useCallback((emoji: FaceEmoji) => { void remove([emoji], groupId); }, [remove, groupId]);
  function dragTargets(value: EmojiDrag): DragLandingState["targets"] {
    return new Map(value.emojis.map((emoji) => [emojiDragId(value.from, emoji), { id: emojiDragId(value.from, emoji), fallback: value.from === "source" ? "source" : admin ? "emoji-library" : `emoji-group:${value.groupId ?? "all"}` }]));
  }
  function beginLanding(snapshot: ReturnType<typeof captureDragStack>, targets: DragLandingState["targets"], pending: boolean, held: string[] = []) {
    if (!snapshot) { finishLanding(); return; }
    setLanding({ snapshot, targets }); setLandingPending(pending);
    setSettling(new Set([...held, ...[...targets.values()].map((item) => item.id)]));
  }
  function cancelDrag() {
    const value = dragRef.current; if (!value) return;
    const snapshot = captureDragStack(dragStack.current, dragPreview);
    endDrag(); beginLanding(snapshot, dragTargets(value), false);
  }
  async function dropEmoji({ over }: DragEndEvent) {
    const value = dragRef.current; if (!value) return;
    const snapshot = captureDragStack(dragStack.current, dragPreview), original = dragTargets(value);
    endDrag(); suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
    if (!over || busy || mutation.current || over.id === "source" && value.from === "source") { beginLanding(snapshot, original, false); return; }
    const targetGroup = over.data.current?.groupId as number | null | undefined;
    const destination = targetGroup === undefined ? groupRef.current : targetGroup;
    if (targetGroup !== undefined) chooseGroup(targetGroup, true);
    const targets = new Map(value.emojis.map((emoji) => [emojiDragId(value.from, emoji), {
      id: over.id === "source" ? `removed:${emojiCellKey(emoji)}` : emojiDragId("library", emoji),
      fallback: over.id === "source" ? "source" : admin ? "emoji-library" : `emoji-group:${destination ?? "all"}`,
    }]));
    beginLanding(snapshot, targets, true, [...original.values()].map((item) => item.id));
    let saved = false;
    try {
      if (over.id === "source") saved = await remove(value.emojis, value.groupId);
      else if (value.from === "source") saved = await add(value.emojis, destination);
      else if (!admin && (targetGroup !== undefined || value.groupId !== destination)) saved = await moveToGroup(value.emojis, value.groupId, destination);
      else {
        const picked = new Set(value.emojis.map(emojiCellKey));
        const target = over.data.current?.emoji as FaceEmoji | undefined;
        const rows = visibleMine.filter((emoji) => !packed.has(emojiCellKey(emoji)));
        const from = rows.findIndex((emoji) => emojiCellKey(emoji) === emojiCellKey(value.emoji)), to = target ? rows.findIndex((emoji) => emojiCellKey(emoji) === emojiCellKey(target)) : -1;
        let next = mine;
        if (!target || !picked.has(emojiCellKey(target))) {
          const moving = mine.filter((emoji) => picked.has(emojiCellKey(emoji)));
          const rest = mine.filter((emoji) => !picked.has(emojiCellKey(emoji)));
          let at = target ? rest.findIndex((emoji) => emojiCellKey(emoji) === emojiCellKey(target)) : -1;
          if (at >= 0 && to > from) at += 1;
          if (at < 0) { const last = rest.reduce((last, emoji, index) => admin || emojiInGroup(emoji, destination) ? index : last, -1); at = last < 0 ? rest.length : last + 1; }
          next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
        }
        saved = await reorder({ ...value, order: next });
      }
    } catch (error) {
      toast.error(failure(error));
    } finally {
      if (snapshot) { setLanding({ snapshot, targets: saved ? targets : original }); setLandingPending(false); }
    }
  }
  function move(step: number) {
    if (
      activeIndex < 0 ||
      activeIndex + step < 0 ||
      activeIndex + step >= mine.length
    )
      return;
    setMine((current) => {
      const next = [...current];
      [next[activeIndex], next[activeIndex + step]] = [
        next[activeIndex + step],
        next[activeIndex],
      ];
      return next;
    });
    setDirty(true);
  }
  async function save() {
    await update(async () => {
      const result = await emojiRequest<{ emojis: FaceEmoji[] }>(
        "/api/admin/emojis",
        { cells: emojiCells(mine) },
      );
      setMine(result.emojis);
      setDirty(false);
      toast.success("默认表情已保存。");
    });
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{
        screenReaderInstructions: { draggable: "按空格或 Enter 开始拖动，方向键移动，空格或 Enter 确认，Escape 取消。" },
        announcements: {
          onDragStart: () => "开始拖动表情。",
          onDragOver: ({ over }) => !over ? "已离开投放区域。" : over.id === "source" ? !admin && dragRef.current?.groupId != null ? "松开将从当前分组移除。" : "松开将从表情库移除。" : "目标：表情库。",
          onDragEnd: ({ over }) => over ? "拖动结束。" : "已取消拖动。",
          onDragCancel: () => "已取消拖动。",
        },
      }}
      measuring={measuring}
      onDragStart={({ active }) => {
        const data = active.data.current;
        if (mutation.current || busy || !ready || !data?.emoji) return;
        finishLanding();
        const emojis = multiSelect === data.from && selectedKeys.has(emojiCellKey(data.emoji))
          ? data.from === "source" ? selected.filter((emoji) => emoji.available) : mine.filter((emoji) => selectedKeys.has(emojiCellKey(emoji)))
          : [data.emoji];
        const value: EmojiDrag = { activeId: String(active.id), emoji: data.emoji, emojis, from: data.from, order: mine, groupId };
        const lookup = new Map(emojis.map((emoji) => [emojiDragId(data.from, emoji), emoji]));
        const captured = captureDragPreview(workbench.current, value.activeId, [...lookup.keys()], (id) => <FaceEmojiImage emoji={lookup.get(id)!} />);
        dragOrigin.current = captured.origin; setDragPreview(captured.preview);
        dragRef.current = value; setDrag(value);
      }}
      onDragOver={({ over }) => {
        if (groupTimer.current) clearTimeout(groupTimer.current);
        groupTimer.current = null;
        const target = over?.data.current?.groupId;
        setDropTarget(over?.id === "source" && dragRef.current?.from === "library" ? "source" : null);
        if (target !== undefined && target !== groupRef.current) groupTimer.current = setTimeout(() => chooseGroup(target, true), 300);
      }}
      onDragCancel={cancelDrag}
      onDragEnd={(event) => { void dropEmoji(event); }}
    >
    <DragSession dragging={Boolean(drag)} onReset={endDrag} />
    <div
      onClickCapture={(event) => { if (suppressClick.current || landing) { event.preventDefault(); event.stopPropagation(); } }}
      ref={workbench}
      className={cn(
        "grid min-w-0 gap-3",
        hasPreview && "pb-[var(--emoji-preview-height,144px)] sm:pb-0",
      )}
    >
      <div className="grid min-w-0 overflow-hidden rounded-md border border-border bg-card sm:h-[min(660px,75dvh)] sm:min-h-[440px] sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <EmojiDropZone zone="source"
          aria-label="查找脸图" data-drag-fallback="source"
          onClick={() => {
            if (multiSelect === "library") setSelected([]);
          }}
          className={cn(
            "relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] border-b border-border sm:border-b-0 sm:border-r",
            dropTarget === "source" &&
              "bg-primary/5 ring-2 ring-inset ring-primary",
          )}
        >
          <header className="flex items-center gap-2 border-b border-border p-3">
            <div className="min-w-0 flex-1">
              <EmojiSourcePicker
                character={character}
                label={sourceLabel}
                hot={source.kind === "hot"}
                onHot={() => {
                  setSelected([]);
                  setSource({ kind: "hot" });
                  setActive(null);
                }}
                onSelect={(item) => {
                  setSelected([]);
                  setSource({ kind: "character", character: item });
                  setActive(null);
                }}
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant={multiSelect === "source" ? "default" : "outline"}
              disabled={busy || savingOrder || !ready}
              aria-label={multiSelect === "source" ? "关闭左栏多选" : "开启左栏多选"}
              title={multiSelect === "source" ? "关闭多选" : "开启多选"}
              aria-pressed={multiSelect === "source"}
              onClick={() => toggleMultiSelect("source")}
            >
              {multiSelect === "source" ? <ListX aria-hidden /> : <ListChecks aria-hidden />}
            </Button>
          </header>
          <SourceFaces
            key={sourceKey(source)}
            source={source}
            defaults={defaults}
            owned={owned}
            active={active}
            selected={multiSelect === "source" ? selectedKeys : null}
            locateVersion={locateVersion}
            disabled={busy || !ready}
            onSelect={selectSource}
            lifted={sourceLifted} settling={settling}
            dragDisabled={busy || savingOrder || !ready}
          />
          {drag?.from === "library" ? (
            <div
              className="pointer-events-none absolute inset-0 grid place-items-center bg-primary/5"
              aria-hidden
            >
              <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-surface">
                <Trash2 />
              </span>
            </div>
          ) : null}
        </EmojiDropZone>
        <EmojiDropZone zone="library"
          aria-label={admin ? "默认清单" : "我的表情"} data-drag-fallback="emoji-library"
          onClick={() => {
            if (multiSelect === "source") setSelected([]);
          }}
          className={cn(
            "relative grid min-h-0 min-w-0",
            admin ? "grid-rows-[auto_minmax(0,1fr)_auto]" : "grid-rows-[auto_auto_minmax(0,1fr)_auto]",
          )}
        >
          <header className="flex min-h-[65px] items-center gap-2 border-b border-border p-3">
            <div className="mr-auto">
              <strong className="text-sm">
                {admin ? "默认清单" : "我的表情"}
              </strong>
              <span className="ml-2 text-xs tabular-nums text-muted">
                {mine.length}
              </span>
              <span role="status" className="ml-2 text-xs text-muted">
                {savingOrder ? "正在保存顺序…" : ""}
              </span>
            </div>
            <Button
              type="button"
              size="icon"
              variant={multiSelect === "library" ? "default" : "outline"}
              disabled={busy || savingOrder || !ready}
              aria-label={multiSelect === "library" ? "关闭右栏多选" : "开启右栏多选"}
              title={multiSelect === "library" ? "关闭多选" : "开启多选"}
              aria-pressed={multiSelect === "library"}
              onClick={() => toggleMultiSelect("library")}
            >
              {multiSelect === "library" ? <ListX aria-hidden /> : <ListChecks aria-hidden />}
            </Button>
            {!admin ? <Button type="button" size="icon" variant="ghost" disabled={busy || savingOrder || !ready} aria-label="分组管理" title="分组管理" onClick={() => setManageGroups(true)}><FolderCog aria-hidden /></Button> : null}
          </header>
          {!admin ? <EmojiGroupTabs management droppable groups={groups} emojis={mine} value={groupId} onSelect={chooseGroup} onCreate={() => void createGroup()} canAdd={(id) => !!drag && (drag.from === "library" && drag.groupId !== null ? id !== drag.groupId : hasAddition(drag.emojis, id))} disabled={busy || savingOrder || !ready} /> : null}
          <div
            ref={mineViewport} data-drag-viewport
            onScroll={(event) => groupScroll.current.set(groupId, event.currentTarget.scrollTop)}
            className="emoji-scroll-viewport h-64 min-h-0 overflow-y-auto p-3 sm:h-auto"
          >
            {loadError ? (
              <div role="alert" className="text-sm">
                {loadError}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRetry((current) => current + 1)}
                >
                  重试
                </Button>
              </div>
            ) : !ready ? (
              <p role="status" className="text-sm text-muted">
                正在加载表情库…
              </p>
            ) : null}
            {ready && !visibleMine.length && !slotId ? (
              <div className="grid min-h-48 place-content-center gap-2 text-center text-sm text-muted">
                <p className="m-0">{groupId === null ? "还没有表情" : "这个分组还没有表情"}</p>
              </div>
            ) : null}
            <SortableContext items={sortableIds} strategy={dragSortingStrategy}>
            <div
              className="relative flex flex-wrap content-start gap-2"
            >
              {slotId && drag?.from === "source" && !admin ? <EmojiDragSlot id={slotId} disabled={busy || savingOrder || !ready} /> : null}
              {visibleMine.map((emoji) => {
                const key = emojiCellKey(emoji);
                const isSelected =
                  multiSelect === "library"
                    ? selectedKeys.has(key)
                    : activeKey === key;
                return (
                  <EmojiSortable
                    key={key}
                    emoji={emoji}
                    disabled={busy || savingOrder || !ready}
                    packed={packed.has(key)} lifted={drag?.from === "library" && dragKeys.has(key)} settling={settling.has(emojiDragId("library", emoji))}
                  >
                    {(handle) => <LibraryEmojiContent emoji={emoji} {...handle} multiple={multiSelect === "library"} selected={isSelected} busy={busy} savingOrder={savingOrder} admin={admin} groupId={groupId} dragging={Boolean(drag || landing)} onSelect={selectLibrary} onRemove={removeLibrary} />}
                  </EmojiSortable>
                );
              })}
              {slotId && (drag?.from === "library" || admin) ? <EmojiDragSlot id={slotId} disabled={busy || savingOrder || !ready} /> : null}
            </div>
            </SortableContext>
          </div>
          <footer>
            {preview ? (
              <div
                ref={previewBar}
                aria-label="表情预览"
                className="fixed inset-x-0 bottom-0 z-[65] grid gap-2 border-t border-border bg-card p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] text-card-foreground shadow-surface sm:static sm:z-auto sm:pb-3 sm:shadow-none"
              >
                <div className="flex items-center gap-3">
                  <FaceEmojiImage emoji={preview} size={96} />
                  <div className="grid min-w-0 flex-1 gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={isRemoval ? "outline" : "default"}
                        disabled={
                          busy ||
                          savingOrder ||
                          !ready ||
                          (hasSelection
                            ? !isRemoval && !canAddSelection
                            : !isRemoval && (!preview.available || !hasAddition([preview], groupId)))
                        }
                        onClick={() => void changeCollection()}
                      >
                        {isRemoval ? (
                          <Trash2 aria-hidden />
                        ) : (
                          <Plus aria-hidden />
                        )}
                        {isRemoval
                          ? admin
                            ? "从默认清单移除"
                            : "从表情库移除"
                          : admin
                            ? "加入默认清单"
                            : "加入我的表情"}
                      </Button>
                      {!admin && isRemoval ? <Button type="button" size="sm" variant="outline" disabled={busy || savingOrder || !ready} onClick={() => {
                        const favorites = (hasSelection ? selected : [preview]).flatMap((emoji) => {
                          const favorite = mineByCell.get(emojiCellKey(emoji));
                          return favorite ? [favorite] : [];
                        });
                        if (favorites.length) setEditingGroups(favorites);
                      }}><FolderCog aria-hidden />编辑分组</Button> : null}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="ml-auto shrink-0"
                        aria-label="关闭表情预览"
                        onClick={() => {
                          setSelected([]);
                          setActive(null);
                        }}
                      >
                        <X />
                      </Button>
                    </div>
                    {hasSelection ? (
                      <p role="status" className="m-0 text-xs text-muted">
                        已选 {selected.length} 个表情
                      </p>
                    ) : preview.sources.length ? (
                      <div
                        className="emoji-scroll-viewport flex max-h-14 flex-wrap gap-1 overflow-y-auto"
                        aria-label="相关角色"
                      >
                        {preview.sources.map((item) => (
                          <Button
                            variant="ghost"
                            size="sm"
                            key={item.id}
                            type="button"
                            className={cn(
                              "min-h-0 cursor-pointer rounded px-1.5 py-1 text-xs font-normal hover:bg-muted/10",
                              item.id === character?.id
                                ? "bg-primary/10 text-primary"
                                : "text-muted",
                            )}
                            onClick={() => locate(preview, item.id)}
                          >
                            {item.name}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <p className="m-0 text-xs text-muted">
                        {preview.available ? "暂无关联角色" : "表情不可用"}
                      </p>
                    )}
                    {admin && !hasSelection && activeIndex >= 0 ? (
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={busy || activeIndex === 0}
                          aria-label="表情前移"
                          onClick={() => move(-1)}
                        >
                          <ArrowLeft />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={busy || activeIndex === mine.length - 1}
                          aria-label="表情后移"
                          onClick={() => move(1)}
                        >
                          <ArrowRight />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {admin ? (
              <div className="flex items-center justify-end gap-2 border-t border-border p-3">
                <span className="mr-auto text-xs text-muted">
                  {dirty ? "尚未保存" : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !ready || !dirty}
                  onClick={() => void save()}
                >
                  保存默认表情
                </Button>
              </div>
            ) : null}
          </footer>
        </EmojiDropZone>
      </div>
    </div>
    <SortableOverlay>{dragPreview ? <DragStack {...dragPreview} className="size-14" itemClassName="grid place-items-center" elementRef={dragStack} /> : null}</SortableOverlay>
    {landing ? <DragLanding landing={landing} pending={landingPending} container={workbench} onFinish={finishLanding} itemClassName="grid place-items-center" /> : null}
    <EmojiGroupManager open={manageGroups} onOpenChange={setManageGroups} groups={groups} onChange={applyLibraryData} onCreated={chooseGroup} />
    {editingGroups ? <EmojiGroupEditor onOpenChange={(open) => { if (!open) setEditingGroups(null); }} groups={groups} emojis={editingGroups} onConfirm={editGroups} /> : null}
    </DndContext>
  );
}

const LibraryEmojiContent = memo(function LibraryEmojiContent({ emoji, attributes, listeners, setActivatorNodeRef, multiple, selected, busy, savingOrder, admin, groupId, dragging, onSelect, onRemove }: import("@/app/components/ui/multi-drag").DragHandle & {
  emoji: FaceEmoji; multiple: boolean; selected: boolean; busy: boolean; savingOrder: boolean; admin: boolean; groupId: number | null; dragging: boolean;
  onSelect: (emoji: FaceEmoji, additive?: boolean) => void; onRemove: (emoji: FaceEmoji) => void;
}) {
  const image = useMemo(() => <FaceEmojiImage emoji={emoji} />, [emoji]);
  return <>
    <Button variant="ghost" size="icon" type="button" aria-label={multiple ? `选择${emoji.sources[0]?.name ?? "表情"}` : `定位${emoji.sources[0]?.name ?? "表情"}的来源脸图`} disabled={busy}
      {...attributes} aria-pressed={selected} {...listeners} ref={setActivatorNodeRef} onContextMenu={(event) => event.preventDefault()}
      className={cn("relative inline-flex size-14 cursor-pointer items-center justify-center rounded border border-transparent hover:border-primary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default", selected && "border-primary bg-primary/5 ring-1 ring-primary")}
      onClick={(event) => { event.stopPropagation(); onSelect(emoji, event.ctrlKey); }}>{image}</Button>
    <Button variant="ghost" size="icon" type="button" aria-label={admin ? "从默认清单移除表情" : groupId === null ? "从表情库移除表情" : "从当前分组移除表情"} title={!admin && groupId !== null ? "移出当前分组" : "移除表情"} disabled={busy || savingOrder}
      onClick={(event) => { event.stopPropagation(); onRemove(emoji); }}
      className={cn("absolute -right-0.5 -top-0.5 z-10 hidden size-4 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:inline-flex [&_svg]:size-2.5", dragging && "invisible")}><X aria-hidden size={10} /></Button>
  </>;
});
