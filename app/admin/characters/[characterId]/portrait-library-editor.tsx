"use client";

import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { FaceSheetCanvas } from "@/app/components/ui/face-sheet-canvas";
import { Input } from "@/app/components/ui/input";
import type { CharacterPortrait as CharacterPortraitValue } from "@/lib/character-names";
import type { AdminFaceSheet } from "@/lib/server/db/character-portrait-library";
import { cn } from "@/lib/ui/cn";

const RESULT_PAGE_SIZE = 48;
const REVIEW_STORAGE_KEY = "viprpg-character-portrait-review.local.v1";

type ReviewStatus = "confirmed" | "skipped";
type ReviewCharacter = { id: number; originalName: string; primaryName: string };
type ReviewProgress = Record<string, ReviewStatus>;

export function PortraitLibraryEditor({
  allSheets,
  characterId,
  characterName,
  characterOriginalName,
  defaultPortrait: initialDefaultPortrait,
  formId,
  initialBoundSheetIds,
  reviewCharacters,
}: {
  allSheets: AdminFaceSheet[];
  characterId: number;
  characterName: string;
  characterOriginalName: string;
  defaultPortrait: CharacterPortraitValue | null;
  formId: string;
  initialBoundSheetIds: number[];
  reviewCharacters: ReviewCharacter[];
}) {
  const characters = useMemo(
    () => [...reviewCharacters].sort((left, right) => left.id - right.id),
    [reviewCharacters],
  );
  const currentCharacterIndex = characters.findIndex((character) => character.id === characterId);
  const initialActiveSheetId = initialDefaultPortrait?.faceSheetId
    ?? initialBoundSheetIds[0]
    ?? bestInitialSheet(allSheets, characterOriginalName)?.id
    ?? allSheets[0]?.id
    ?? null;
  const [boundSheetIds, setBoundSheetIds] = useState(initialBoundSheetIds);
  const [defaultPortrait, setDefaultPortrait] = useState(initialDefaultPortrait);
  const [activeSheetId, setActiveSheetId] = useState<number | null>(initialActiveSheetId);
  const [pendingCell, setPendingCell] = useState<{ row: number; column: number } | null>(
    initialDefaultPortrait && initialDefaultPortrait.faceSheetId === initialActiveSheetId
      ? { row: initialDefaultPortrait.row, column: initialDefaultPortrait.column }
      : null,
  );
  const [query, setQuery] = useState(characterOriginalName);
  const [resultLimit, setResultLimit] = useState(RESULT_PAGE_SIZE);
  const [characterQuery, setCharacterQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const deferredCharacterQuery = useDeferredValue(characterQuery);
  const reviewProgressSnapshot = useSyncExternalStore(
    subscribeReviewProgress,
    readReviewProgressSnapshot,
    emptyReviewProgressSnapshot,
  );
  const reviewProgress = useMemo(
    () => parseReviewProgress(reviewProgressSnapshot),
    [reviewProgressSnapshot],
  );

  const sheetsById = useMemo(
    () => new Map(allSheets.map((sheet) => [sheet.id, sheet])),
    [allSheets],
  );
  const indexedSheets = useMemo(
    () => allSheets.map((sheet) => ({ sheet, searchText: sheetSearchText(sheet) })),
    [allSheets],
  );
  const boundSheetIdSet = useMemo(() => new Set(boundSheetIds), [boundSheetIds]);
  const matchingSheets = useMemo(() => {
    const terms = normalizeSearch(deferredQuery).split(" ").filter(Boolean);
    return indexedSheets
      .filter(({ searchText }) => terms.every((term) => searchText.includes(term)))
      .map(({ sheet }) => sheet);
  }, [deferredQuery, indexedSheets]);
  const visibleSheets = matchingSheets.slice(0, resultLimit);
  const visibleGroups = useMemo(() => groupSheetsByPage(visibleSheets), [visibleSheets]);
  const activeSheet = activeSheetId === null ? null : sheetsById.get(activeSheetId) ?? null;
  const activeIsBound = activeSheet ? boundSheetIdSet.has(activeSheet.id) : false;
  const selectedCell = pendingCell ?? (
    activeSheet && defaultPortrait?.faceSheetId === activeSheet.id
      ? { row: defaultPortrait.row, column: defaultPortrait.column }
      : null
  );
  const portraitForReview = activeSheet && selectedCell
    ? {
        faceSheetId: activeSheet.id,
        blobSha256: activeSheet.blobSha256,
        width: activeSheet.width,
        height: activeSheet.height,
        row: selectedCell.row,
        column: selectedCell.column,
      }
    : defaultPortrait;
  const characterMatches = useMemo(() => {
    const terms = normalizeSearch(deferredCharacterQuery).split(" ").filter(Boolean);
    if (!terms.length) return [];
    return characters
      .filter((character) => terms.every((term) => characterSearchText(character).includes(term)))
      .slice(0, 8);
  }, [characters, deferredCharacterQuery]);
  const confirmedCount = characters.filter((character) => reviewProgress[character.id] === "confirmed").length;
  const skippedCount = characters.filter((character) => reviewProgress[character.id] === "skipped").length;
  const reviewedCount = confirmedCount + skippedCount;
  const unreviewedCount = Math.max(0, characters.length - reviewedCount);
  const currentReviewStatus = reviewProgress[characterId] ?? null;
  const previousCharacter = currentCharacterIndex > 0 ? characters[currentCharacterIndex - 1] : null;
  const nextCharacter = currentCharacterIndex >= 0 && currentCharacterIndex + 1 < characters.length
    ? characters[currentCharacterIndex + 1]
    : null;
  const nextUnreviewedCharacter = findNextUnreviewed(
    characters,
    currentCharacterIndex,
    reviewProgress,
  );

  function selectSheet(sheet: AdminFaceSheet) {
    setActiveSheetId(sheet.id);
    setPendingCell(
      defaultPortrait?.faceSheetId === sheet.id
        ? { row: defaultPortrait.row, column: defaultPortrait.column }
        : null,
    );
  }

  function toggleActiveBinding() {
    if (!activeSheet) return;
    if (activeIsBound) {
      setBoundSheetIds((current) => current.filter((id) => id !== activeSheet.id));
      if (defaultPortrait?.faceSheetId === activeSheet.id) setDefaultPortrait(null);
      setPendingCell(null);
      return;
    }
    setBoundSheetIds((current) => [...current, activeSheet.id]);
  }

  function selectDefaultPortrait() {
    if (!activeSheet || !selectedCell) return;
    if (!activeIsBound) setBoundSheetIds((current) => [...current, activeSheet.id]);
    setDefaultPortrait({
      faceSheetId: activeSheet.id,
      blobSha256: activeSheet.blobSha256,
      width: activeSheet.width,
      height: activeSheet.height,
      row: selectedCell.row,
      column: selectedCell.column,
    });
    setPendingCell(selectedCell);
  }

  function clearDefaultPortrait() {
    if (defaultPortrait?.faceSheetId === activeSheet?.id) setPendingCell(null);
    setDefaultPortrait(null);
  }

  async function saveReview(status: ReviewStatus) {
    if (status === "confirmed" && !portraitForReview) return;
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) {
      setSaveError("找不到角色编辑表单，请刷新页面后重试。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const formData = new FormData(form);
      const nextBoundSheetIds = status === "confirmed" && portraitForReview
        ? [...new Set([...boundSheetIds, portraitForReview.faceSheetId])]
        : boundSheetIds;
      formData.set("face_sheet_ids", JSON.stringify(nextBoundSheetIds));
      formData.set(
        "default_portrait",
        status === "confirmed" && portraitForReview
          ? JSON.stringify({
              blobSha256: portraitForReview.blobSha256,
              row: portraitForReview.row,
              column: portraitForReview.column,
            })
          : "",
      );
      formData.set("merge_target_id", "");
      const response = await fetch(form.action, {
        body: formData,
        headers: { Accept: "application/json" },
        method: "POST",
      });
      const payload = await response.json() as { detail?: string; error?: string; ok?: boolean };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.detail || payload.error || "角色资料保存失败");
      }
      const nextProgress = { ...reviewProgress, [characterId]: status };
      try {
        writeReviewProgress(nextProgress);
      } catch {
        throw new Error("角色资料已保存，但无法写入本机审核进度。请允许此站点保存数据后重试。");
      }
      const nextTarget = findNextUnreviewed(characters, currentCharacterIndex, nextProgress)
        ?? nextCharacter;
      if (nextTarget) {
        window.location.assign(characterHref(nextTarget.id));
      } else {
        window.location.reload();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "角色资料保存失败");
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3">
      <input name="face_sheet_ids" readOnly type="hidden" value={JSON.stringify(boundSheetIds)} />
      <input
        name="default_portrait"
        readOnly
        type="hidden"
        value={defaultPortrait ? JSON.stringify({
          blobSha256: defaultPortrait.blobSha256,
          row: defaultPortrait.row,
          column: defaultPortrait.column,
        }) : ""}
      />

      <nav className="grid gap-2 border border-border bg-card p-3" aria-label="角色审核导航">
        <div className="flex items-center gap-2">
          <Button
            disabled={!previousCharacter || saving}
            onClick={() => previousCharacter && goToCharacter(previousCharacter.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            上一个
          </Button>
          <div className="relative min-w-64 flex-1">
            <Input
              aria-label="跳转角色"
              className="h-9"
              onChange={(event) => setCharacterQuery(event.target.value)}
              placeholder="输入角色原名、译名或 #ID"
              type="search"
              value={characterQuery}
            />
            {characterMatches.length ? (
              <div className="absolute inset-x-0 top-[calc(100%+0.25rem)] z-30 max-h-72 overflow-y-auto border border-border bg-card p-1 shadow-surface">
                {characterMatches.map((character) => (
                  <Button
                    className="flex w-full justify-between rounded-sm px-2.5 text-left font-normal"
                    key={character.id}
                    onClick={() => goToCharacter(character.id)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <span className="truncate">{character.originalName} · {character.primaryName}</span>
                    <span className="shrink-0 text-xs text-muted">#{character.id}</span>
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          <Button
            disabled={!nextCharacter || saving}
            onClick={() => nextCharacter && goToCharacter(nextCharacter.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            下一个
          </Button>
          <Button
            disabled={!nextUnreviewedCharacter || saving}
            onClick={() => nextUnreviewedCharacter && goToCharacter(nextUnreviewedCharacter.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            下个未处理
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <strong className="mr-auto truncate text-sm">
            {currentCharacterIndex + 1} / {characters.length} · {characterOriginalName} · {characterName}
          </strong>
          <ReviewStatusBadge status={currentReviewStatus} />
          <span className="text-muted">已处理 {reviewedCount}</span>
          <span className="text-emerald-700">已确认 {confirmedCount}</span>
          <span className="text-amber-700">暂不设置 {skippedCount}</span>
          <span className="text-muted">未处理 {unreviewedCount}</span>
        </div>
      </nav>

      <div className="grid h-[min(680px,calc(100vh-180px))] min-h-[520px] grid-cols-[minmax(440px,1.1fr)_minmax(380px,0.9fr)] overflow-hidden border border-border bg-card">
        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-border" aria-label="脸图素材表">
          <header className="grid gap-2 border-b border-border p-3">
            <div className="flex items-baseline justify-between gap-3">
              <strong className="text-sm">素材表</strong>
              <span className="text-xs text-muted">显示 {visibleSheets.length} / {matchingSheets.length}</span>
            </div>
            <Input
              aria-label="搜索素材表"
              className="h-9"
              onChange={(event) => {
                setQuery(event.target.value);
                setResultLimit(RESULT_PAGE_SIZE);
              }}
              placeholder="页名、文件名、#素材表 ID"
              type="search"
              value={query}
            />
          </header>

          <div className="min-h-0 overflow-y-auto p-3">
            {visibleGroups.length ? (
              <div className="grid gap-4">
                {visibleGroups.map(([pageTitle, sheets]) => (
                  <section className="grid gap-2" key={pageTitle}>
                    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1">
                      <strong className="truncate text-sm" title={pageTitle}>{pageTitle}</strong>
                      <span className="shrink-0 text-xs text-muted">{sheets.length} 张</span>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
                      {sheets.map((sheet) => {
                        const active = sheet.id === activeSheetId;
                        const bound = boundSheetIdSet.has(sheet.id);
                        const filename = sheetFilename(sheet);
                        return (
                          <Button
                            aria-pressed={active}
                            className={cn(
                              "grid h-auto min-w-0 justify-stretch gap-1 rounded-sm border p-1.5 text-left font-normal",
                              active ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-card",
                            )}
                            key={sheet.id}
                            onClick={() => selectSheet(sheet)}
                            title={sheetImageLabel(sheet)}
                            type="button"
                            variant="ghost"
                          >
                            <Image
                              alt=""
                              className="aspect-square w-full border border-foreground/10 bg-muted/10 object-contain [image-rendering:pixelated]"
                              height={sheet.height}
                              loading="lazy"
                              src={`/api/media/blobs/${sheet.blobSha256}`}
                              unoptimized
                              width={sheet.width}
                            />
                            <span className="truncate text-xs">#{sheet.id} · {filename || "未命名"}</span>
                            <span className={cn("text-[11px]", bound ? "font-semibold text-primary" : "text-muted")}>
                              {bound ? "已绑定" : `${sheet.width}×${sheet.height}`}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {resultLimit < matchingSheets.length ? (
                  <Button
                    className="justify-self-start"
                    onClick={() => setResultLimit((current) => current + RESULT_PAGE_SIZE)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    显示更多
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted">没有匹配的素材表</div>
            )}
          </div>
        </section>

        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]" aria-label="默认头像选择">
          <header className="flex min-h-16 items-start justify-between gap-3 border-b border-border p-3">
            {activeSheet ? (
              <>
                <div className="min-w-0">
                  <strong className="block truncate text-sm" title={sheetPageLabel(activeSheet)}>{sheetPageLabel(activeSheet)}</strong>
                  <span className="block truncate text-xs text-muted" title={sheetFilename(activeSheet)}>
                    #{activeSheet.id} · {sheetFilename(activeSheet) || "未命名"} · {activeSheet.width}×{activeSheet.height}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={cn("text-xs font-semibold", activeIsBound ? "text-primary" : "text-muted")}>
                    {activeIsBound ? "已绑定" : "未绑定"}
                  </span>
                  {activeSheet.sourcePageUrl ? (
                    <Link className="text-xs text-primary hover:underline" href={activeSheet.sourcePageUrl} rel="noreferrer" target="_blank">来源页</Link>
                  ) : null}
                </div>
              </>
            ) : (
              <strong className="text-sm">选择一张素材表</strong>
            )}
          </header>

          <div className="grid min-h-0 place-items-center overflow-auto bg-muted/5 p-4">
            {activeSheet ? (
              <FaceSheetCanvas
                blobSha256={activeSheet.blobSha256}
                height={activeSheet.height}
                label={`在 ${sheetImageLabel(activeSheet)} 中选择 ${characterName} 的默认头像`}
                onSelectCell={(row, column) => setPendingCell({ row, column })}
                scale={Math.min(2, 360 / Math.max(activeSheet.width, activeSheet.height))}
                selectedCell={selectedCell}
                width={activeSheet.width}
              />
            ) : (
              <span className="text-sm text-muted">从左侧选择素材表</span>
            )}
          </div>

          <footer className="flex min-h-16 items-center gap-2 border-t border-border p-3">
            <strong className="min-w-0 flex-1 truncate text-sm">
              {selectedCell ? `第 ${selectedCell.row + 1} 行，第 ${selectedCell.column + 1} 列` : "尚未选择头像"}
            </strong>
            {defaultPortrait ? <Button onClick={clearDefaultPortrait} size="sm" type="button" variant="ghost">清除默认</Button> : null}
            <Button disabled={!activeSheet} onClick={toggleActiveBinding} size="sm" type="button" variant="outline">
              {activeIsBound ? "解除绑定" : "绑定素材表"}
            </Button>
            <Button disabled={!activeSheet || !selectedCell} onClick={selectDefaultPortrait} size="sm" type="button">
              {activeIsBound ? "选为默认" : "绑定并选为默认"}
            </Button>
          </footer>
        </section>
      </div>

      <div className="flex min-h-12 items-center gap-2 border border-border bg-background p-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          已绑定 {boundSheetIds.length} 张 · {defaultPortrait ? `默认 #${defaultPortrait.faceSheetId} ${defaultPortrait.row + 1}-${defaultPortrait.column + 1}` : "无默认头像"}
        </span>
        {saveError ? <span className="text-xs font-semibold text-red-700" role="alert">{saveError}</span> : null}
        <Button
          disabled={saving}
          onClick={() => void saveReview("skipped")}
          type="button"
          variant="outline"
        >
          {saving ? "保存中…" : "暂不设置并下一个"}
        </Button>
        <Button disabled={saving || !portraitForReview} onClick={() => void saveReview("confirmed")} type="button">
          {saving ? "保存中…" : "确认并下一个"}
        </Button>
      </div>
    </div>
  );
}

function ReviewStatusBadge({ status }: { status: ReviewStatus | null }) {
  if (status === "confirmed") return <Badge variant="positive">已确认</Badge>;
  if (status === "skipped") return <Badge variant="pending">暂不设置</Badge>;
  return <Badge variant="secondary">未处理</Badge>;
}

function subscribeReviewProgress(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function readReviewProgressSnapshot(): string {
  try {
    return localStorage.getItem(REVIEW_STORAGE_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function emptyReviewProgressSnapshot(): string {
  return "{}";
}

function parseReviewProgress(snapshot: string): ReviewProgress {
  try {
    const value = JSON.parse(snapshot);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, status]) => status === "confirmed" || status === "skipped"),
    ) as ReviewProgress;
  } catch {
    return {};
  }
}

function writeReviewProgress(progress: ReviewProgress) {
  localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(progress));
}

function findNextUnreviewed(
  characters: ReviewCharacter[],
  currentIndex: number,
  progress: ReviewProgress,
): ReviewCharacter | null {
  if (!characters.length) return null;
  for (let offset = 1; offset <= characters.length; offset += 1) {
    const character = characters[(Math.max(currentIndex, 0) + offset) % characters.length];
    if (!progress[character.id]) return character;
  }
  return null;
}

function characterHref(characterId: number): string {
  return `/admin/characters/${characterId}#portrait-workbench`;
}

function goToCharacter(characterId: number) {
  window.location.assign(characterHref(characterId));
}

function characterSearchText(character: ReviewCharacter): string {
  return normalizeSearch([character.id, `#${character.id}`, character.originalName, character.primaryName].join(" "));
}

function bestInitialSheet(sheets: AdminFaceSheet[], originalName: string): AdminFaceSheet | null {
  const query = normalizeSearch(originalName);
  return sheets.find((sheet) => sheetSearchText(sheet).includes(query)) ?? null;
}

function groupSheetsByPage(sheets: AdminFaceSheet[]): Array<[string, AdminFaceSheet[]]> {
  const groups = new Map<string, AdminFaceSheet[]>();
  for (const sheet of sheets) {
    const label = sheetPageLabel(sheet);
    const group = groups.get(label) ?? [];
    group.push(sheet);
    groups.set(label, group);
  }
  return [...groups.entries()];
}

function sheetPageLabel(sheet: AdminFaceSheet): string {
  return sheet.sourcePageTitle || "未分类素材";
}

function sheetImageLabel(sheet: AdminFaceSheet): string {
  const filename = sheetFilename(sheet);
  return filename ? `${sheetPageLabel(sheet)} · ${filename}` : sheetPageLabel(sheet);
}

function sheetFilename(sheet: AdminFaceSheet): string {
  if (!sheet.sourceImageUrl) return "";
  try {
    return decodeURIComponent(new URL(sheet.sourceImageUrl).pathname.split("/").at(-1) ?? "");
  } catch {
    return sheet.sourceImageUrl.split("/").at(-1) ?? "";
  }
}

function sheetSearchText(sheet: AdminFaceSheet): string {
  return normalizeSearch([
    sheet.id,
    `#${sheet.id}`,
    sheet.sourcePageTitle,
    sheet.sourceSectionTitle,
    sheetFilename(sheet),
    sheet.blobSha256,
  ].filter(Boolean).join(" "));
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ja").replace(/\s+/g, " ");
}
