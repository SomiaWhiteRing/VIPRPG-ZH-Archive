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
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { FaceSheetCanvas } from "@/app/components/ui/face-sheet-canvas";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/components/ui/tabs";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import type { CharacterIndexData } from "@/lib/character-index";
import type { CharacterMaterialKind } from "@/lib/character-materials";
import { CHARACTER_MATERIAL_CATEGORIES } from "@/lib/character-materials";
import type { CharacterPortrait as Portrait } from "@/lib/character-names";
import type {
  AdminCharacterMaterial,
  AdminCharacterMaterialPage,
  AdminFaceSheet,
} from "@/lib/dto/db/character-portrait-library";
import type { ApiResponsePayload } from "@/lib/ui/api-response";
import { requestJson } from "@/lib/ui/api-response";
import { inspectCharacterFaceSheetFile } from "@/lib/ui/character-face-sheet";
import { cn } from "@/lib/ui/cn";
import {
  Check,
  GripVertical,
  ImagePlus,
  RefreshCw,
  Search,
  Undo2,
  X,
} from "lucide-react";
import type { DragEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CharacterTreeSearch } from "./character-tree-search";

const PAGE_SIZE = 48;
const MATERIAL_DRAG_TYPE = "application/x-viprpg-workbench-material";
type Material = AdminCharacterMaterial & {
  key: string;
  title: string;
  group: string;
  sourceUrl?: string | null;
  search: string;
};
type Configuration = {
  faceIds: number[];
  materialIds: number[];
  portrait: Portrait | null;
};
type UploadResponse = ApiResponsePayload & {
  sheet?: AdminFaceSheet;
  material?: AdminCharacterMaterial;
};

export function PortraitLibraryEditor({
  canManage,
  canUpload,
  initialSheets,
  initialMaterials,
  characterId,
  characterName,
  characterOriginalName,
  defaultPortrait,
  initialBoundSheetIds,
  initialBoundMaterialIds,
  characterIndex,
}: {
  canManage: boolean;
  canUpload: boolean;
  initialSheets: AdminFaceSheet[];
  initialMaterials: AdminCharacterMaterial[];
  characterId: number;
  characterName: string;
  characterOriginalName: string;
  defaultPortrait: Portrait | null;
  initialBoundSheetIds: number[];
  initialBoundMaterialIds: number[];
  characterIndex: CharacterIndexData;
}) {
  const navigateRoute = useNavigate();

  const initial = {
    faceIds: initialBoundSheetIds,
    materialIds: initialBoundMaterialIds,
    portrait: defaultPortrait,
  };
  const [saved, setSaved] = useState<Configuration>(initial);
  const [draft, setDraft] = useState<Configuration>(initial);
  const [undo, setUndo] = useState<Configuration | null>(null);
  const [materials, setMaterials] = useState<Material[]>(() => [
    ...initialSheets.map(fromSheet),
    ...initialMaterials.map(fromMaterial),
  ]);
  const [kind, setKind] = useState<CharacterMaterialKind>("faceset");
  const [boundOnly, setBoundOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [libraryOffset, setLibraryOffset] = useState(0);
  const [library, setLibrary] = useState<{
    key: string;
    offset: number;
    items: Material[];
    nextOffset: number | null;
  } | null>(null);
  const [libraryFailure, setLibraryFailure] = useState<{
    key: string;
    offset: number;
    message: string;
  } | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(
    defaultPortrait ? `faceset:${defaultPortrait.faceSheetId}` : null,
  );
  const [cell, setCell] = useState<{
    key: string;
    row: number;
    column: number;
  } | null>(null);
  const [zoom, setZoom] = useState("fit");
  const [background, setBackground] = useState("checker");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const internalDrag = useRef<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    key: string;
    after: boolean;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = normalize(query);
  const libraryKey = JSON.stringify([kind, normalizedQuery, libraryRevision]);
  const libraryError =
    libraryFailure?.key === libraryKey &&
    libraryFailure.offset === libraryOffset
      ? libraryFailure.message
      : "";
  const libraryLoading =
    !boundOnly &&
    !libraryError &&
    (library?.key !== libraryKey || library.offset !== libraryOffset);
  const dirty = configurationKey(draft) !== configurationKey(saved);
  const endpoint = `/api/admin/characters/${characterId}/materials`;
  const publicHashes = useMemo(
    () =>
      new Set(
        materials
          .filter((item) => item.isPublic)
          .map((item) => item.blobSha256),
      ),
    [materials],
  );
  const imageUrl = (hash: string) =>
    publicHashes.has(hash)
      ? `/api/media/blobs/${hash}`
      : `${endpoint}?blob=${hash}`;
  const label = CHARACTER_MATERIAL_CATEGORIES.find(
    (category) => category.kind === kind,
  )!.label;
  const boundKeys = useMemo(
    () =>
      new Set([
        ...draft.faceIds.map((id) => `faceset:${id}`),
        ...draft.materialIds.map((id) => `material:${id}`),
      ]),
    [draft.faceIds, draft.materialIds],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        CHARACTER_MATERIAL_CATEGORIES.map(({ kind }) => [
          kind,
          materials.filter(
            (item) => item.kind === kind && boundKeys.has(item.key),
          ).length,
        ]),
      ),
    [materials, boundKeys],
  );
  const matching = useMemo(() => {
    if (!boundOnly) return library?.key === libraryKey ? library.items : [];
    const terms = normalizedQuery.split(" ").filter(Boolean);
    const order = new Map(
      (kind === "faceset" ? draft.faceIds : draft.materialIds).map(
        (id, index) => [id, index],
      ),
    );
    return materials
      .filter(
        (item) =>
          item.kind === kind &&
          boundKeys.has(item.key) &&
          terms.every((term) =>
            term.startsWith("#")
              ? String(item.id) === term.slice(1)
              : item.search.includes(term),
          ),
      )
      .sort(
        (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
      );
  }, [
    materials,
    kind,
    boundOnly,
    boundKeys,
    normalizedQuery,
    draft.faceIds,
    draft.materialIds,
    library,
    libraryKey,
  ]);
  const visible = boundOnly ? matching.slice(0, limit) : matching;
  const groups = new Map<string, Material[]>();
  for (const item of visible) {
    const groupKey = boundOnly ? "" : item.group;
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }
  const active =
    matching.find((item) => item.key === activeKey) ?? matching[0] ?? null;
  const isBound = Boolean(active && boundKeys.has(active.key));
  const selectedCell =
    active && cell?.key === active.key
      ? cell
      : active?.kind === "faceset" && draft.portrait?.faceSheetId === active.id
        ? draft.portrait
        : null;
  const isDefaultCell = Boolean(
    active?.kind === "faceset" &&
      selectedCell &&
      draft.portrait?.faceSheetId === active.id &&
      draft.portrait.row === selectedCell.row &&
      draft.portrait.column === selectedCell.column,
  );
  const canSort = canManage && boundOnly && !busy;

  useEffect(() => {
    if (boundOnly) return;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          const params = new URLSearchParams({
            kind,
            q: normalizedQuery,
            offset: String(libraryOffset),
          });
          const result = await requestJson<
            ApiResponsePayload & AdminCharacterMaterialPage
          >(
            `${endpoint}?${params}`,
            {
              credentials: "same-origin",
              signal: controller.signal,
            },
            "素材库读取失败",
          );
          if (controller.signal.aborted) return;
          const items = [
            ...result.sheets.map(fromSheet),
            ...result.materials.map(fromMaterial),
          ];
          setLibrary((previous) => ({
            key: libraryKey,
            offset: libraryOffset,
            nextOffset: result.nextOffset,
            items: mergeMaterials(
              libraryOffset > 0 && previous?.key === libraryKey
                ? previous.items
                : [],
              items,
            ),
          }));
          // Keep metadata for every selected material even when a search page is replaced.
          setMaterials((previous) => mergeMaterials(previous, items));
          setLibraryFailure(null);
        } catch (reason) {
          if (!controller.signal.aborted)
            setLibraryFailure({
              key: libraryKey,
              offset: libraryOffset,
              message:
                reason instanceof Error ? reason.message : "素材库读取失败",
            });
        }
      },
      normalizedQuery ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [boundOnly, endpoint, kind, normalizedQuery, libraryOffset, libraryKey]);

  function changeQuery(value: string) {
    setQuery(value);
    setLimit(PAGE_SIZE);
    setLibraryOffset(0);
  }

  function changeScope(bound: boolean) {
    setBoundOnly(bound);
    changeQuery("");
    if (!bound) setLibraryRevision((revision) => revision + 1);
  }

  useNavigationGuard(
    dirty || busy,
    () => !busy && window.confirm("当前角色的素材修改尚未保存，确定离开？"),
  );

  function edit(next: Configuration, feedback: string) {
    if (!canManage || busyRef.current) return;
    setUndo(draft);
    setDraft(next);
    setMessage(feedback);
    setError("");
  }

  function changeBinding(items: Material[], bind: boolean) {
    const faceIds = new Set(draft.faceIds);
    const materialIds = new Set(draft.materialIds);
    for (const item of items) {
      const ids = item.kind === "faceset" ? faceIds : materialIds;
      if (bind) ids.add(item.id);
      else ids.delete(item.id);
    }
    edit(
      {
        faceIds: [...faceIds],
        materialIds: [...materialIds],
        portrait:
          draft.portrait && faceIds.has(draft.portrait.faceSheetId)
            ? draft.portrait
            : null,
      },
      `${bind ? "已添加" : "已解除"} ${items.length} 张素材的绑定`,
    );
  }

  function resetDrag() {
    internalDrag.current = null;
    setDragKey(null);
    setDropTarget(null);
    setDragging(false);
  }

  function reorder(sourceKey: string, targetKey: string, after: boolean) {
    if (!canSort || busyRef.current || sourceKey === targetKey) return;
    const source = materials.find((item) => item.key === sourceKey);
    const target = materials.find((item) => item.key === targetKey);
    if (
      !source ||
      !target ||
      source.kind !== kind ||
      target.kind !== kind ||
      !boundKeys.has(sourceKey) ||
      !boundKeys.has(targetKey)
    )
      return;
    const field = kind === "faceset" ? "faceIds" : "materialIds";
    const categoryIds = new Set(
      materials.filter((item) => item.kind === kind).map((item) => item.id),
    );
    const sorted = draft[field].filter(
      (id) => categoryIds.has(id) && id !== source.id,
    );
    sorted.splice(sorted.indexOf(target.id) + (after ? 1 : 0), 0, source.id);
    let index = 0;
    const next = draft[field].map((id) =>
      categoryIds.has(id) ? sorted[index++] : id,
    );
    if (next.every((id, position) => id === draft[field][position])) return;
    edit({ ...draft, [field]: next }, "素材顺序已调整");
    setActiveKey(sourceKey);
  }

  function previewDrop(event: DragEvent<HTMLButtonElement>, item: Material) {
    if (!internalDrag.current || !canSort || internalDrag.current === item.key)
      return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const after = event.clientX >= bounds.left + bounds.width / 2;
    setDropTarget((previous) =>
      previous?.key === item.key && previous.after === after
        ? previous
        : { key: item.key, after },
    );
  }

  function setPortrait() {
    if (!active || active.kind !== "faceset" || !selectedCell) return;
    edit(
      {
        ...draft,
        faceIds: [...new Set([...draft.faceIds, active.id])],
        portrait: {
          faceSheetId: active.id,
          blobSha256: active.blobSha256,
          width: active.width,
          height: active.height,
          row: selectedCell.row,
          column: selectedCell.column,
        },
      },
      "默认头像已更新",
    );
  }

  async function save() {
    if (!canManage || busyRef.current || !dirty) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("正在保存…");
    try {
      const body = new FormData();
      body.set("face_sheet_ids", JSON.stringify(draft.faceIds));
      body.set("material_ids", JSON.stringify(draft.materialIds));
      body.set(
        "default_portrait",
        draft.portrait
          ? JSON.stringify({
              blobSha256: draft.portrait.blobSha256,
              row: draft.portrait.row,
              column: draft.portrait.column,
            })
          : "",
      );
      await requestJson(
        endpoint,
        { method: "PUT", body, credentials: "same-origin" },
        "素材保存失败",
      );
      const boundMaterials = new Set(draft.materialIds);
      setMaterials((current) =>
        current.map((item) =>
          item.kind !== "faceset" && boundMaterials.has(item.id)
            ? { ...item, isPublic: 1 }
            : item,
        ),
      );
      setSaved(draft);
      setUndo(null);
      setMessage("素材已保存");
    } catch (error) {
      setError(error instanceof Error ? error.message : "素材保存失败");
      setMessage("");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function upload(files: File[]) {
    if (!canUpload || busyRef.current || !files.length) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setUndo(null);
    const failures: string[] = [];
    let succeeded = 0;
    for (const [index, file] of files.entries()) {
      setMessage(`上传 ${index + 1} / ${files.length} · ${file.name}`);
      try {
        const body = new FormData();
        if (kind === "faceset") {
          await inspectCharacterFaceSheetFile(file);
          body.set("face_sheet", file);
        } else {
          if (!file.size || file.size > 2 * 1024 * 1024)
            throw new Error("请选择不超过 2 MiB 的图片");
          body.set("image", file);
          body.set("kind", kind);
        }
        const payload = await requestJson<UploadResponse>(
          kind === "faceset"
            ? `/api/admin/characters/${characterId}/face-sheets`
            : endpoint,
          { method: "POST", body, credentials: "same-origin" },
          "素材上传失败",
        );
        const item = payload.sheet
          ? fromSheet(payload.sheet)
          : payload.material
            ? fromMaterial(payload.material)
            : null;
        if (!item) throw new Error("服务器没有返回素材资料，请刷新确认");
        setMaterials((items) => [
          item,
          ...items.filter((other) => other.key !== item.key),
        ]);
        const append = (config: Configuration): Configuration =>
          item.kind === "faceset"
            ? { ...config, faceIds: [...new Set([...config.faceIds, item.id])] }
            : {
                ...config,
                materialIds: [...new Set([...config.materialIds, item.id])],
              };
        setDraft(append);
        setSaved(append);
        setActiveKey(item.key);
        setQuery("");
        setBoundOnly(true);
        setLimit(PAGE_SIZE);
        succeeded++;
      } catch (error) {
        failures.push(
          `${file.name}：${error instanceof Error ? error.message : "上传失败"}`,
        );
      }
    }
    setMessage(succeeded ? `${succeeded} 张素材已上传并保存` : "");
    setError(failures.join("\n"));
    busyRef.current = false;
    setBusy(false);
  }

  function navigate(id: number) {
    if (busyRef.current) return;
    const path = `/admin/characters/${id}#portrait-workbench`;
    if (dirty) setPendingNavigation(path);
    else navigateRoute(path);
  }

  function changeKind(value: string) {
    resetDrag();
    setKind(value as CharacterMaterialKind);
    changeQuery("");
    setZoom("fit");
    setCell(null);
  }

  return (
    <div className="grid min-w-0 gap-3">
      <nav aria-label="角色导航" className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">
            {characterOriginalName} · {characterName}
          </strong>
          <span className="text-xs text-muted">#{characterId}</span>
        </div>
        <CharacterTreeSearch
          data={characterIndex}
          characterId={characterId}
          disabled={busy}
          onSelect={navigate}
        />
      </nav>

      <Tabs value={kind} onValueChange={changeKind}>
        <TabsList aria-label="素材分类" className="overflow-x-auto">
          {CHARACTER_MATERIAL_CATEGORIES.map((category) => (
            <TabsTrigger
              disabled={busy}
              key={category.kind}
              value={category.kind}
              className="shrink-0"
            >
              {category.label}
              <span className="rounded bg-muted/10 px-1.5 text-xs tabular-nums">
                {counts[category.kind]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={kind} className="pb-0 pt-3">
          <div
            className={cn(
              "relative grid min-w-0 overflow-hidden rounded-md border bg-card lg:h-[660px] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]",
              dragging ? "border-primary ring-2 ring-primary" : "border-border",
            )}
            onDragStartCapture={(event) => {
              if (
                !(event.target instanceof Element) ||
                !event.target.closest('[data-material-sortable="true"]')
              )
                event.preventDefault();
            }}
            onDragOver={(event) => {
              if (
                internalDrag.current ||
                event.dataTransfer.types.includes(MATERIAL_DRAG_TYPE)
              ) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "none";
                setDropTarget(null);
                return;
              }
              if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                event.dataTransfer.dropEffect =
                  canUpload && !busy ? "copy" : "none";
                setDragging(canUpload && !busy);
              }
            }}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const isInternal =
                internalDrag.current !== null ||
                event.dataTransfer.types.includes(MATERIAL_DRAG_TYPE);
              resetDrag();
              if (!isInternal && event.dataTransfer.types.includes("Files"))
                void upload(Array.from(event.dataTransfer.files));
            }}
          >
            {dragging ? (
              <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-card/95 text-lg font-semibold text-primary">
                松开即可上传到「{label}」
              </div>
            ) : null}
            <section
              aria-label={`${label}素材库`}
              className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] border-b border-border lg:border-b-0 lg:border-r"
            >
              <header className="grid gap-3 border-b border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div
                    className="flex gap-1"
                    role="group"
                    aria-label="素材范围"
                  >
                    <Button
                      aria-pressed={boundOnly}
                      onClick={() => changeScope(true)}
                      size="sm"
                      type="button"
                      variant={boundOnly ? "secondary" : "ghost"}
                    >
                      已绑定 {counts[kind]}
                    </Button>
                    <Button
                      aria-pressed={!boundOnly}
                      onClick={() => changeScope(false)}
                      size="sm"
                      type="button"
                      variant={!boundOnly ? "secondary" : "ghost"}
                    >
                      素材库
                    </Button>
                  </div>
                  {canUpload ? (
                    <Button
                      disabled={busy}
                      onClick={() => inputRef.current?.click()}
                      size="sm"
                      type="button"
                      variant="outline"
                      title={
                        kind === "faceset"
                          ? "PNG · 不超过 256 KiB · 48 像素网格"
                          : "PNG、JPEG、GIF、WebP · 每张不超过 2 MiB"
                      }
                    >
                      <ImagePlus size={16} />
                      上传{label}
                    </Button>
                  ) : null}
                  <input
                    aria-label={`上传${label}`}
                    accept={
                      kind === "faceset"
                        ? "image/png"
                        : "image/png,image/jpeg,image/gif,image/webp"
                    }
                    className="sr-only"
                    disabled={!canUpload || busy}
                    multiple
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void upload(files);
                    }}
                    ref={inputRef}
                    type="file"
                  />
                </div>
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="absolute left-3 top-3 text-muted"
                    size={16}
                  />
                  <Input
                    aria-label={`搜索${label}`}
                    className="pl-9 pr-9"
                    placeholder={
                      kind === "faceset"
                        ? "搜索来源、文件名或 #ID"
                        : "搜索关联角色、#ID 或文件哈希"
                    }
                    type="search"
                    maxLength={160}
                    value={query}
                    onChange={(event) => changeQuery(event.target.value)}
                  />
                  {query ? (
                    <Button
                      aria-label="清空素材搜索"
                      className="absolute right-1 top-1 h-8 w-8"
                      onClick={() => changeQuery("")}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <X size={14} />
                    </Button>
                  ) : null}
                </div>
                <span className="text-xs text-muted" role="status">
                  {libraryLoading
                    ? "加载中…"
                    : !boundOnly
                      ? `已加载 ${matching.length} 张${label}`
                      : query
                        ? `找到 ${matching.length} 张`
                        : `${matching.length} 张${label}`}
                </span>
              </header>
              <div className="max-h-[440px] min-h-48 overflow-y-auto p-3 lg:max-h-none">
                {matching.length ? (
                  <div className="grid gap-4">
                    {Array.from(groups, ([group, items]) => (
                      <section className="grid gap-2" key={group}>
                        {group ? (
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <strong
                              className="truncate text-xs text-muted"
                              title={group}
                            >
                              {group}
                            </strong>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
                          {items.map((item) => (
                            <Button
                              aria-label={`${item.title}，${boundKeys.has(item.key) ? "已绑定" : "未绑定"}`}
                              aria-pressed={active?.key === item.key}
                              aria-keyshortcuts={
                                canSort
                                  ? "Alt+ArrowLeft Alt+ArrowRight"
                                  : undefined
                              }
                              className={cn(
                                "group relative grid h-auto min-w-0 justify-stretch gap-0 rounded-md border p-2 text-left font-normal transition-colors hover:border-primary",
                                active?.key === item.key
                                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                                  : "border-border",
                                canSort && "cursor-grab active:cursor-grabbing",
                                dragKey === item.key && "opacity-40",
                              )}
                              key={item.key}
                              data-material-sortable={canSort}
                              draggable={canSort}
                              title={
                                canSort ? `拖动排序：${item.title}` : item.title
                              }
                              onDragStart={(event) => {
                                if (!canSort) {
                                  event.preventDefault();
                                  return;
                                }
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  MATERIAL_DRAG_TYPE,
                                  item.key,
                                );
                                internalDrag.current = item.key;
                                setDragKey(item.key);
                                setDragging(false);
                              }}
                              onDragEnd={resetDrag}
                              onDragOver={(event) => previewDrop(event, item)}
                              onDragLeave={(event) => {
                                if (
                                  !event.currentTarget.contains(
                                    event.relatedTarget as Node | null,
                                  )
                                )
                                  setDropTarget((previous) =>
                                    previous?.key === item.key
                                      ? null
                                      : previous,
                                  );
                              }}
                              onDrop={(event) => {
                                const source = internalDrag.current;
                                if (!source) return;
                                event.preventDefault();
                                event.stopPropagation();
                                const bounds =
                                  event.currentTarget.getBoundingClientRect();
                                reorder(
                                  source,
                                  item.key,
                                  event.clientX >=
                                    bounds.left + bounds.width / 2,
                                );
                                resetDrag();
                              }}
                              onKeyDown={(event) => {
                                if (
                                  !canSort ||
                                  !event.altKey ||
                                  !["ArrowLeft", "ArrowRight"].includes(
                                    event.key,
                                  )
                                )
                                  return;
                                event.preventDefault();
                                const index = matching.findIndex(
                                  (entry) => entry.key === item.key,
                                );
                                const after = event.key === "ArrowRight";
                                const target =
                                  matching[index + (after ? 1 : -1)];
                                if (target)
                                  reorder(item.key, target.key, after);
                              }}
                              onClick={() => {
                                setActiveKey(item.key);
                                setZoom("fit");
                              }}
                              type="button"
                              variant="ghost"
                            >
                              {dropTarget?.key === item.key ? (
                                <span
                                  aria-hidden
                                  className={cn(
                                    "pointer-events-none absolute -bottom-1 -top-1 z-10 w-1 rounded-full bg-primary",
                                    dropTarget.after
                                      ? "-right-1.5"
                                      : "-left-1.5",
                                  )}
                                />
                              ) : null}
                              {canSort ? (
                                <GripVertical
                                  aria-hidden
                                  className="absolute left-1 top-1 rounded bg-card/90 text-muted"
                                />
                              ) : null}
                              <img
                                alt=""
                                draggable={false}
                                className="aspect-square w-full bg-muted/5 object-contain [image-rendering:pixelated]"
                                height={item.height}
                                loading="lazy"
                                src={imageUrl(item.blobSha256)}
                                width={item.width}
                              />
                              {boundKeys.has(item.key) ? (
                                <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                                  <Check size={12} />
                                </span>
                              ) : null}
                              <span
                                className="mt-2 block truncate text-xs"
                                title={item.title}
                              >
                                {item.title}
                              </span>
                              <span className="block text-[11px] text-muted">
                                {item.kind === "faceset" &&
                                draft.portrait?.faceSheetId === item.id
                                  ? "默认头像所在图"
                                  : `${item.width} × ${item.height}`}
                              </span>
                            </Button>
                          ))}
                        </div>
                      </section>
                    ))}
                    {boundOnly && limit < matching.length ? (
                      <Button
                        onClick={() =>
                          setLimit((current) => current + PAGE_SIZE)
                        }
                        type="button"
                        variant="outline"
                      >
                        再显示 {Math.min(PAGE_SIZE, matching.length - limit)} 张
                        · 还剩 {matching.length - limit} 张
                      </Button>
                    ) : null}
                    {!boundOnly &&
                    library?.key === libraryKey &&
                    library.nextOffset !== null &&
                    !libraryError ? (
                      <Button
                        disabled={libraryLoading}
                        onClick={() => setLibraryOffset(library.nextOffset!)}
                        type="button"
                        variant="outline"
                      >
                        {libraryLoading ? "加载中…" : "加载更多"}
                      </Button>
                    ) : null}
                  </div>
                ) : libraryLoading || libraryError ? null : (
                  <div className="grid min-h-48 content-center justify-items-center gap-3 text-center">
                    <ImagePlus
                      aria-hidden="true"
                      size={28}
                      className="text-muted"
                    />
                    <p className="text-sm text-muted">
                      {query
                        ? "没有匹配的素材"
                        : boundOnly
                          ? `还没有绑定${label}`
                          : `素材库暂无${label}`}
                    </p>
                    {query ? (
                      <Button
                        onClick={() => changeQuery("")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        清空搜索
                      </Button>
                    ) : boundOnly ? (
                      <Button
                        onClick={() => changeScope(false)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        从素材库添加
                      </Button>
                    ) : canUpload ? (
                      <Button
                        disabled={busy}
                        onClick={() => inputRef.current?.click()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        上传第一张
                      </Button>
                    ) : null}
                  </div>
                )}
                {!boundOnly && libraryError ? (
                  <div className="grid justify-items-start gap-2 py-3">
                    <p className="text-sm text-destructive" role="alert">
                      {libraryError}
                    </p>
                    <Button
                      onClick={() => {
                        setLibraryOffset(0);
                        setLibraryRevision((revision) => revision + 1);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RefreshCw aria-hidden size={14} />
                      重试
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>

            <section
              aria-label="素材预览"
              className="grid min-h-[380px] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]"
            >
              <header className="grid gap-3 border-b border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong
                      className="block truncate text-sm"
                      title={active?.title}
                    >
                      {active?.title ?? "素材预览"}
                    </strong>
                    <span className="text-xs text-muted">
                      {active
                        ? `#${active.id} · ${active.width} × ${active.height}`
                        : "选择一张图片"}
                    </span>
                  </div>
                  {active ? (
                    <span
                      className={cn(
                        "shrink-0 rounded px-2 py-1 text-xs",
                        isBound
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/10 text-muted",
                      )}
                    >
                      {isBound ? "已绑定" : "未绑定"}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SelectField
                    aria-label="预览缩放"
                    triggerClassName="h-8 gap-2 px-2 text-xs"
                    value={zoom}
                    onValueChange={setZoom}
                    options={[
                      { value: "fit", label: "适应窗口" },
                      { value: "1", label: "100%" },
                      { value: "2", label: "200%" },
                      { value: "4", label: "400%" },
                    ]}
                  />
                  <div
                    className="flex gap-1"
                    role="group"
                    aria-label="预览背景"
                  >
                    {[
                      {
                        value: "checker",
                        label: "透明网格",
                        color:
                          "bg-[conic-gradient(#ddd_25%,white_0_50%,#ddd_0_75%,white_0)] bg-[length:8px_8px]",
                      },
                      { value: "light", label: "浅色背景", color: "bg-white" },
                      {
                        value: "dark",
                        label: "深色背景",
                        color: "bg-zinc-900",
                      },
                    ].map((swatch) => (
                      <Button
                        aria-label={swatch.label}
                        aria-pressed={background === swatch.value}
                        title={swatch.label}
                        className={cn(
                          "h-7 w-7 min-h-0 rounded border p-1",
                          background === swatch.value && "ring-1 ring-primary",
                        )}
                        key={swatch.value}
                        onClick={() => setBackground(swatch.value)}
                        size="icon"
                        type="button"
                        variant="outline"
                      >
                        <span
                          className={cn(
                            "h-full w-full rounded-sm",
                            swatch.color,
                          )}
                        />
                      </Button>
                    ))}
                  </div>
                  {active ? (
                    <a
                      className="ml-auto text-xs text-primary hover:underline"
                      href={imageUrl(active.blobSha256)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      原图 ↗
                    </a>
                  ) : null}
                  {active?.sourceUrl ? (
                    <Link
                      className="text-xs text-primary hover:underline"
                      to={active.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      来源 ↗
                    </Link>
                  ) : null}
                </div>
              </header>
              <div
                className={cn(
                  "min-h-60 overflow-auto p-4",
                  background === "dark"
                    ? "bg-zinc-900"
                    : background === "light"
                      ? "bg-white"
                      : "bg-card bg-[conic-gradient(rgb(128_128_128_/_0.14)_25%,transparent_0_50%,rgb(128_128_128_/_0.14)_0_75%,transparent_0)] bg-[length:16px_16px]",
                )}
              >
                {active ? (
                  <div className="flex min-h-full min-w-full items-start justify-start">
                    <div
                      className={cn(
                        "m-auto shrink-0",
                        zoom === "fit" && "max-w-full",
                      )}
                    >
                      {active.kind === "faceset" ? (
                        <FaceSheetCanvas
                          src={imageUrl(active.blobSha256)}
                          height={active.height}
                          width={active.width}
                          label={`为${characterName}选择默认头像`}
                          onSelectCell={(row, column) =>
                            setCell({ key: active.key, row, column })
                          }
                          scale={
                            zoom === "fit"
                              ? Math.min(
                                  2,
                                  240 / Math.max(active.width, active.height),
                                )
                              : Number(zoom)
                          }
                          selectedCell={selectedCell}
                        />
                      ) : (
                        <img
                          alt={active.title}
                          className={cn(
                            "block object-contain [image-rendering:pixelated]",
                            zoom === "fit"
                              ? "h-auto max-h-96 w-auto max-w-full"
                              : "max-w-none",
                          )}
                          height={
                            active.height * (zoom === "fit" ? 1 : Number(zoom))
                          }
                          width={
                            active.width * (zoom === "fit" ? 1 : Number(zoom))
                          }
                          src={imageUrl(active.blobSha256)}
                          loading="lazy"
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid h-full min-h-60 place-items-center text-sm text-muted">
                    未选择素材
                  </div>
                )}
              </div>
              <footer className="grid gap-3 border-t border-border p-3">
                {kind === "faceset" ? (
                  <div className="flex items-center gap-2">
                    <CharacterPortrait
                      displayName={characterName}
                      portrait={draft.portrait}
                      previewSrc={
                        draft.portrait
                          ? imageUrl(draft.portrait.blobSha256)
                          : undefined
                      }
                      size={36}
                      className="h-9 w-9"
                    />
                    <div className="flex-1 text-xs">
                      <strong className="block">
                        {draft.portrait ? "当前默认头像" : "尚未设置默认头像"}
                      </strong>
                      <span className="text-muted">
                        {selectedCell
                          ? `已选第 ${selectedCell.row + 1} 行 · 第 ${selectedCell.column + 1} 列`
                          : "待选头像"}
                      </span>
                    </div>
                    {draft.portrait && canManage ? (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          edit({ ...draft, portrait: null }, "已清除默认头像")
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        清除
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {canManage ? (
                    <Button
                      className="flex-1"
                      disabled={!active || busy}
                      onClick={() =>
                        active && changeBinding([active], !isBound)
                      }
                      type="button"
                      variant={isBound ? "outline" : "default"}
                    >
                      {isBound ? "解除绑定" : "绑定当前角色"}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted">仅浏览</span>
                  )}
                  {canManage && kind === "faceset" ? (
                    <Button
                      className="flex-1"
                      disabled={
                        !active || !selectedCell || isDefaultCell || busy
                      }
                      onClick={setPortrait}
                      type="button"
                      variant="secondary"
                    >
                      {isDefaultCell ? "已是默认头像" : "设为默认头像"}
                    </Button>
                  ) : null}
                </div>
                {canManage && active?.kind === "faceset" && isBound ? (
                  <Button
                    disabled={busy}
                    className="justify-self-start"
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      changeBinding(
                        materials.filter(
                          (item) =>
                            item.kind === "faceset" &&
                            boundKeys.has(item.key) &&
                            (item.sourceUrl ?? item.group) ===
                              (active.sourceUrl ?? active.group),
                        ),
                        false,
                      )
                    }
                  >
                    解绑同来源
                  </Button>
                ) : null}
              </footer>
            </section>
          </div>
        </TabsContent>
      </Tabs>

      {error ? (
        <div
          className="whitespace-pre-line break-words rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3 shadow-surface">
        <div
          className="min-w-0 flex-1 break-words text-sm"
          role="status"
          aria-live="polite"
        >
          <span
            className={cn(
              "mr-2 inline-block h-2 w-2 rounded-full",
              dirty ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
          {busy
            ? message
            : dirty
              ? `${message || "素材已修改"} · 待保存`
              : message || "素材已同步"}
        </div>
        {undo && canManage ? (
          <Button
            disabled={busy}
            onClick={() => {
              setDraft(undo);
              setUndo(null);
              setMessage("已撤销上一步");
              setError("");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Undo2 size={14} />
            撤销
          </Button>
        ) : null}
        {canManage ? (
          <Button
            disabled={!dirty || busy}
            onClick={() => void save()}
            size="sm"
            type="button"
          >
            {busy ? "处理中…" : "保存素材"}
          </Button>
        ) : null}
      </div>
      <AlertDialog
        open={pendingNavigation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNavigation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>放弃未保存的素材修改？</AlertDialogTitle>
          <AlertDialogDescription>
            当前角色的素材修改尚未保存。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                继续编辑
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (!pendingNavigation) return;
                  setDraft(saved);
                  navigateRoute(pendingNavigation);
                  setPendingNavigation(null);
                }}
              >
                放弃并离开
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function fromSheet(sheet: AdminFaceSheet): Material {
  let filename = sheet.sourceSectionTitle ?? "";
  if (sheet.sourceImageUrl) {
    try {
      filename = decodeURIComponent(
        new URL(sheet.sourceImageUrl).pathname.split("/").at(-1) ?? "",
      );
    } catch {
      filename = sheet.sourceImageUrl.split("/").at(-1) ?? filename;
    }
  }
  return {
    ...sheet,
    kind: "faceset",
    key: `faceset:${sheet.id}`,
    relatedNames: "",
    isPublic: Number(sheet.libraryStatus === "approved"),
    title: filename || `脸图 #${sheet.id}`,
    group: sheet.sourcePageTitle || "其他来源",
    sourceUrl: sheet.sourcePageUrl,
    search: normalize(
      `${sheet.id} ${sheet.sourcePageTitle ?? ""} ${sheet.sourceSectionTitle ?? ""} ${filename} ${sheet.blobSha256}`,
    ),
  };
}
function fromMaterial(material: AdminCharacterMaterial): Material {
  const label = CHARACTER_MATERIAL_CATEGORIES.find(
    (category) => category.kind === material.kind,
  )!.label;
  return {
    ...material,
    key: `material:${material.id}`,
    title: `${label} #${material.id}`,
    group: "",
    search: normalize(
      `${material.id} ${material.relatedNames} ${material.blobSha256}`,
    ),
  };
}
function normalize(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ja")
    .replace(/\s+/g, " ");
}
function configurationKey(value: Configuration) {
  return JSON.stringify(value);
}

function mergeMaterials(
  existing: Material[],
  incoming: Material[],
): Material[] {
  const items = new Map(existing.map((item) => [item.key, item]));
  for (const item of incoming) items.set(item.key, item);
  return [...items.values()];
}
