import { useConfirm } from "@/app/components/ui/confirm-provider";
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
import { useToast } from "@/app/components/ui/toast";
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
import { formatFeedbackError } from "@/lib/i18n/feedback";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
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
  title: string | null;
  group: string | null;
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
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
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
  const [submittedQuery, setSubmittedQuery] = useState("");
  const searchComposing = useRef(false);
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
  const normalizedQuery = normalize(submittedQuery);
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
  const label = t(`character.material.${kind}`);
  function materialTitle(item: Material) {
    if (item.title) return item.title;
    return item.kind === "faceset"
      ? t("admin.portraits.faceTitle", { id: item.id })
      : t("admin.portraits.assetTitle", { kind: t(`character.material.${item.kind}`), id: item.id });
  }
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
  const groups = new Map<string | null, Material[]>();
  for (const item of visible) {
    const groupKey = boundOnly ? "" : item.group;
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }
  const active =
    matching.find((item) => item.key === activeKey) ?? matching[0] ?? null;
  const activeTitle = active ? materialTitle(active) : undefined;
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
    void (async () => {
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
          t("admin.portraits.readFailed"),
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
              formatFeedbackError(reason, locale, t("admin.portraits.readFailed")),
          });
      }
    })();
    return () => controller.abort();
  }, [boundOnly, endpoint, kind, normalizedQuery, libraryOffset, libraryKey, locale, t]);

  function changeQuery(value: string) {
    setQuery(value);
    setSubmittedQuery(value.trim());
    setLimit(PAGE_SIZE);
    setLibraryOffset(0);
  }

  function changeScope(bound: boolean) {
    setBoundOnly(bound);
    changeQuery("");
    if (!bound) setLibraryRevision((revision) => revision + 1);
  }

  const confirm = useConfirm();
  const toast = useToast();
  useNavigationGuard(
    dirty || busy,
    () => !busy && confirm(t("admin.portraits.leave")),
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
      t("admin.portraits.bindingChanged", { bind: bind ? "yes" : "no", count: items.length }),
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
    edit({ ...draft, [field]: next }, t("admin.portraits.order"));
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
      t("admin.portraits.defaultUpdated"),
    );
  }

  async function save() {
    if (!canManage || busyRef.current || !dirty) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage(t("admin.portraits.saving"));
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
        t("admin.portraits.saveFailed"),
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
      setMessage("");
      toast.success(t("admin.portraits.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error : t("admin.portraits.saveFailed"));
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
      setMessage(t("admin.portraits.uploadProgress", { index: index + 1, count: files.length, name: file.name }));
      try {
        const body = new FormData();
        if (kind === "faceset") {
          await inspectCharacterFaceSheetFile(file);
          body.set("face_sheet", file);
        } else {
          if (!file.size || file.size > 2 * 1024 * 1024)
            throw new Error(t("admin.portraits.invalidImage"));
          body.set("image", file);
          body.set("kind", kind);
        }
        const payload = await requestJson<UploadResponse>(
          kind === "faceset"
            ? `/api/admin/characters/${characterId}/face-sheets`
            : endpoint,
          { method: "POST", body, credentials: "same-origin" },
          t("admin.portraits.uploadFailed"),
        );
        const item = payload.sheet
          ? fromSheet(payload.sheet)
          : payload.material
            ? fromMaterial(payload.material)
            : null;
        if (!item) throw new Error(t("admin.portraits.missingResponse"));
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
          t("upload.faces.readDetail", { name: file.name, detail: formatFeedbackError(error, locale, t("admin.portraits.uploadFailed")) }),
        );
      }
    }
    setMessage("");
    if (succeeded) toast.success(t("admin.portraits.uploaded", { count: succeeded }));
    if (failures.length) toast.error(t("admin.portraits.uploadFailures", { count: failures.length }));
    setError(failures.join("\n"));
    busyRef.current = false;
    setBusy(false);
  }

  function navigate(id: number) {
    if (busyRef.current) return;
    const search = navigationLocale ? `?${new URLSearchParams({ [UI_LOCALE_PARAM]: navigationLocale })}` : "";
    const path = `/admin/characters/${id}${search}#portrait-workbench`;
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
      <nav aria-label={t("admin.portraits.characterNav")} className="flex flex-wrap items-center gap-2">
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
        <TabsList aria-label={t("admin.portraits.categories")} className="overflow-x-auto">
          {CHARACTER_MATERIAL_CATEGORIES.map((category) => (
            <TabsTrigger
              disabled={busy}
              key={category.kind}
              value={category.kind}
              className="shrink-0"
            >
              {t(`character.material.${category.kind}`)}
              <span className="rounded bg-muted/10 px-1.5 text-xs tabular-nums">
                {counts[category.kind]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={kind} className="pb-0 pt-3">
          <div
            className={cn(
              "admin-workspace-panel relative grid min-w-0 overflow-hidden border bg-card lg:h-[660px] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]",
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
                {t("admin.portraits.drop", { label })}
              </div>
            ) : null}
            <section
              aria-label={t("admin.portraits.namedLibrary", { label })}
              className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] border-b border-border lg:border-b-0 lg:border-r"
            >
              <header className="grid gap-3 border-b border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div
                    className="flex gap-1"
                    role="group"
                    aria-label={t("admin.portraits.scope")}
                  >
                    <Button
                      aria-pressed={boundOnly}
                      onClick={() => changeScope(true)}
                      size="sm"
                      type="button"
                      variant={boundOnly ? "neutral" : "ghost"}
                    >
                      {t("admin.portraits.boundCount", { count: counts[kind] })}
                    </Button>
                    <Button
                      aria-pressed={!boundOnly}
                      onClick={() => changeScope(false)}
                      size="sm"
                      type="button"
                      variant={!boundOnly ? "neutral" : "ghost"}
                    >
                      {t("admin.portraits.library")}
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
                          ? t("admin.portraits.faceFormat")
                          : t("admin.portraits.imageFormat")
                      }
                    >
                      <ImagePlus size={16} />
                      {t("admin.portraits.upload", { label })}
                    </Button>
                  ) : null}
                  <input
                    aria-label={t("admin.portraits.upload", { label })}
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
                    aria-label={t("admin.portraits.search", { label })}
                    className="pl-9 pr-9"
                    placeholder={
                      kind === "faceset"
                        ? t("admin.portraits.faceSearch")
                        : t("admin.portraits.otherSearch")
                    }
                    type="search"
                    enterKeyHint="search"
                    maxLength={160}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onCompositionStart={() => { searchComposing.current = true; }}
                    onCompositionEnd={() => { searchComposing.current = false; }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || searchComposing.current) return;
                      event.preventDefault(); event.stopPropagation();
                      if (event.repeat) return;
                      if (!boundOnly && normalizedQuery === normalize(query) && libraryOffset === 0) {
                        if (libraryLoading) return;
                        setLibraryRevision((revision) => revision + 1);
                      }
                      changeQuery(query);
                    }}
                  />
                  {query || submittedQuery ? (
                    <Button
                      aria-label={t("admin.portraits.clearSearch")}
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
                    ? t("admin.portraits.loading")
                    : !boundOnly
                      ? t("admin.portraits.loaded", { count: matching.length, label })
                      : submittedQuery
                        ? t("admin.portraits.found", { count: matching.length })
                        : t("admin.portraits.categoryCount", { count: matching.length, label })}
                </span>
              </header>
              <div className="max-h-[440px] min-h-48 overflow-y-auto p-3 lg:max-h-none">
                {matching.length ? (
                  <div className="grid gap-4">
                    {Array.from(groups, ([group, items]) => (
                      <section className="grid gap-2" key={group === null ? "fallback" : `source:${group}`}>
                        {group !== "" ? (
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <strong
                              className="truncate text-xs text-muted"
                              title={group ?? t("admin.portraits.otherSources")}
                            >
                              {group ?? t("admin.portraits.otherSources")}
                            </strong>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
                          {items.map((item) => (
                            <Button
                              aria-label={t("admin.portraits.namedBinding", { title: materialTitle(item), status: t(boundKeys.has(item.key) ? "admin.portraits.bound" : "admin.portraits.unbound") })}
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
                                canSort ? t("admin.portraits.dragOrder", { title: materialTitle(item) }) : materialTitle(item)
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
                                title={materialTitle(item)}
                              >
                                {materialTitle(item)}
                              </span>
                              <span className="block text-[11px] text-muted">
                                {item.kind === "faceset" &&
                                draft.portrait?.faceSheetId === item.id
                                  ? t("admin.portraits.defaultSheet")
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
                        {t("admin.portraits.showMore", { count: Math.min(PAGE_SIZE, matching.length - limit), remaining: matching.length - limit })}
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
                        {libraryLoading ? t("admin.portraits.loading") : t("admin.portraits.loadMore")}
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
                      {submittedQuery
                        ? t("admin.portraits.noMatches")
                        : boundOnly
                          ? t("admin.portraits.noneBound", { label })
                          : t("admin.portraits.noneInLibrary", { label })}
                    </p>
                    {submittedQuery ? (
                      <Button
                        onClick={() => changeQuery("")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t("admin.portraits.clearSearch")}
                      </Button>
                    ) : boundOnly ? (
                      <Button
                        onClick={() => changeScope(false)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t("admin.portraits.addFromLibrary")}
                      </Button>
                    ) : canUpload ? (
                      <Button
                        disabled={busy}
                        onClick={() => inputRef.current?.click()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t("admin.portraits.uploadFirst")}
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
                      {t("admin.portraits.retry")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>

            <section
              aria-label={t("admin.portraits.preview")}
              className="grid min-h-[380px] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]"
            >
              <header className="grid gap-3 border-b border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong
                      className="block truncate text-sm"
                      title={activeTitle}
                    >
                      {activeTitle ?? t("admin.portraits.preview")}
                    </strong>
                    <span className="text-xs text-muted">
                      {active
                        ? `#${active.id} · ${active.width} × ${active.height}`
                        : t("admin.portraits.choose")}
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
                      {isBound ? t("admin.portraits.bound") : t("admin.portraits.unbound")}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SelectField
                    aria-label={t("admin.portraits.zoom")}
                    triggerClassName="h-8 gap-2 px-2 text-xs"
                    value={zoom}
                    onValueChange={setZoom}
                    options={[
                      { value: "fit", label: t("admin.portraits.fit") },
                      { value: "1", label: "100%" },
                      { value: "2", label: "200%" },
                      { value: "4", label: "400%" },
                    ]}
                  />
                  <div
                    className="flex gap-1"
                    role="group"
                    aria-label={t("admin.portraits.background")}
                  >
                    {[
                      {
                        value: "checker",
                        label: t("admin.portraits.checker"),
                        color:
                          "bg-[conic-gradient(#ddd_25%,white_0_50%,#ddd_0_75%,white_0)] bg-[length:8px_8px]",
                      },
                      { value: "light", label: t("admin.portraits.light"), color: "bg-white" },
                      {
                        value: "dark",
                        label: t("admin.portraits.dark"),
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
                      {t("admin.portraits.original")}
                    </a>
                  ) : null}
                  {active?.sourceUrl ? (
                    <Link
                      className="text-xs text-primary hover:underline"
                      to={active.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("admin.portraits.source")}
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
                          label={t("admin.portraits.chooseDefault", { name: characterName })}
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
                          alt={activeTitle}
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
                    {t("admin.portraits.noneSelected")}
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
                        {draft.portrait ? t("admin.portraits.currentDefault") : t("admin.portraits.noDefault")}
                      </strong>
                      <span className="text-muted">
                        {selectedCell
                          ? t("admin.portraits.selectedCell", { row: selectedCell.row + 1, column: selectedCell.column + 1 })
                          : t("upload.character.portraitPending")}
                      </span>
                    </div>
                    {draft.portrait && canManage ? (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          edit({ ...draft, portrait: null }, t("admin.portraits.defaultCleared"))
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {t("admin.list.clear")}
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
                      {isBound ? t("admin.portraits.unbind") : t("admin.portraits.bind")}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted">{t("admin.portraits.browse")}</span>
                  )}
                  {canManage && kind === "faceset" ? (
                    <Button
                      className="flex-1"
                      disabled={
                        !active || !selectedCell || isDefaultCell || busy
                      }
                      onClick={setPortrait}
                      type="button"
                      variant="neutral"
                    >
                      {isDefaultCell ? t("admin.portraits.alreadyDefault") : t("admin.portraits.setDefault")}
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
                    {t("admin.portraits.unbindSource")}
                  </Button>
                ) : null}
              </footer>
            </section>
          </div>
        </TabsContent>
      </Tabs>

      {error ? (
        <div
          className="whitespace-pre-line wrap-anywhere rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      <div className="admin-save-bar">
        <div
          className="min-w-0 flex-1 wrap-anywhere text-sm"
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
              ? t("admin.portraits.unsaved", { message: message || t("admin.portraits.modified") })
              : message || t("admin.portraits.synced")}
        </div>
        {undo && canManage ? (
          <Button
            disabled={busy}
            onClick={() => {
              setDraft(undo);
              setUndo(null);
              setMessage(t("admin.portraits.undone"));
              setError("");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Undo2 size={14} />
            {t("character.manager.undo")}
          </Button>
        ) : null}
        {canManage ? (
          <Button
            disabled={!dirty || busy}
            onClick={() => void save()}
            size="sm"
            type="button"
          >
            {busy ? t("core.confirm.working") : t("admin.portraits.save")}
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
          <AlertDialogTitle>{t("admin.portraits.discardTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("admin.portraits.discardDescription")}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                {t("admin.portraits.continue")}
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
                {t("admin.portraits.discard")}
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
    title: filename || null,
    group: sheet.sourcePageTitle || null,
    sourceUrl: sheet.sourcePageUrl,
    search: normalize(
      `${sheet.id} ${sheet.sourcePageTitle ?? ""} ${sheet.sourceSectionTitle ?? ""} ${filename} ${sheet.blobSha256}`,
    ),
  };
}
function fromMaterial(material: AdminCharacterMaterial): Material {
  return {
    ...material,
    key: `material:${material.id}`,
    title: null,
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
