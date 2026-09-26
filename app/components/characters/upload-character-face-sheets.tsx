import { Button, buttonVariants } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { FaceSheetCanvas } from "@/app/components/ui/face-sheet-canvas";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import type { CharacterCreditSelection } from "@/lib/character-names";
import { inspectCharacterFaceSheetFile } from "@/lib/ui/character-face-sheet";
import { cn } from "@/lib/ui/cn";
import { ArrowRight, Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const FACE_SHEET_DRAG_TYPE = "application/x-viprpg-character-face-sheet";

type FaceSheetDraft = Pick<CharacterCreditSelection, "portrait" | "faceSheetBlobSha256s"> & {
  files: File[];
};

type Preview = {
  file: File;
  src: string;
  sha256: string;
  width: number;
  height: number;
};

export function UploadCharacterFaceSheets({
  credit,
  disabled,
  files,
  onConfirm,
  sourceFiles,
  sourceLoading,
  sourceWarnings,
}: {
  credit: CharacterCreditSelection;
  disabled: boolean;
  files: File[];
  onConfirm: (draft: FaceSheetDraft) => void;
  sourceFiles: File[];
  sourceLoading: boolean;
  sourceWarnings: string[];
}) {
  const [draft, setDraft] = useState<FaceSheetDraft>(() => ({
    files,
    portrait: credit.portrait,
    faceSheetBlobSha256s: credit.faceSheetBlobSha256s,
  }));
  const [query, setQuery] = useState("");
  const [activeHash, setActiveHash] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragHash = useRef<string | null>(null);
  const sourcePreviews = useFaceSheetPreviews(sourceFiles);
  const assignedPreviews = useFaceSheetPreviews(draft.files);
  const previewsByHash = new Map(
    [...sourcePreviews.previews, ...assignedPreviews.previews].map((sheet) => [sheet.sha256, sheet]),
  );
  const sourceSheets = [...new Map(
    sourcePreviews.previews.map((sheet) => [sheet.sha256, sheet]),
  ).values()];
  const visibleSheets = sourceSheets.filter((sheet) =>
    sheet.file.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const assignedHashes = new Set(draft.faceSheetBlobSha256s);
  const assignedSheets = draft.faceSheetBlobSha256s.flatMap((hash) => {
    const sheet = previewsByHash.get(hash);
    return sheet ? [sheet] : [];
  });
  const activeSheet = sourceSheets.find((sheet) => sheet.sha256 === activeHash);
  const portraitSheet = draft.portrait ? previewsByHash.get(draft.portrait.blobSha256) : null;
  const portrait = draft.portrait && portraitSheet ? {
    ...draft.portrait,
    faceSheetId: 0,
    width: portraitSheet.width,
    height: portraitSheet.height,
  } : null;
  const busy = disabled || adding;
  const warnings = [...sourceWarnings, ...sourcePreviews.errors];

  function addSheets(sheets: Array<Pick<Preview, "file" | "sha256">>) {
    if (disabled) return;
    setDraft((current) => {
      const hashes = new Set(current.faceSheetBlobSha256s);
      const added = sheets.filter((sheet) => {
        if (hashes.has(sheet.sha256)) return false;
        hashes.add(sheet.sha256);
        return true;
      });
      if (!added.length) return current;
      return {
        files: [...current.files, ...added.map((sheet) => sheet.file)],
        faceSheetBlobSha256s: [...current.faceSheetBlobSha256s, ...added.map((sheet) => sheet.sha256)],
        portrait: current.portrait ?? { blobSha256: added[0].sha256, row: 0, column: 0 },
      };
    });
    setError(null);
  }

  async function addLocalFiles(nextFiles: File[]) {
    if (busy || !nextFiles.length) return;
    setAdding(true);
    const added: Array<Pick<Preview, "file" | "sha256">> = [];
    const failures: string[] = [];
    for (const file of nextFiles) {
      try {
        const sheet = await inspectCharacterFaceSheetFile(file);
        added.push({ file, sha256: sheet.sha256 });
      } catch (error) {
        failures.push(`${file.name}：${error instanceof Error ? error.message : "无法读取脸图。"}`);
      }
    }
    addSheets(added);
    setError(failures.length ? failures.join("\n") : null);
    setAdding(false);
  }

  function removeSheet(hash: string) {
    if (busy) return;
    setDraft((current) => {
      const index = current.faceSheetBlobSha256s.indexOf(hash);
      const hashes = current.faceSheetBlobSha256s.filter((item) => item !== hash);
      return {
        files: current.files.filter((_, fileIndex) => fileIndex !== index),
        faceSheetBlobSha256s: hashes,
        portrait: current.portrait?.blobSha256 === hash
          ? hashes.length ? { blobSha256: hashes[0], row: 0, column: 0 } : null
          : current.portrait,
      };
    });
  }

  function endDrag() {
    dragHash.current = null;
    setDropActive(false);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] sm:grid-rows-1">
      <section aria-label="当前作品的脸图" className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] border-b border-border sm:border-b-0 sm:border-r">
        <header className="grid gap-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <strong className="text-sm">角色脸图</strong>
            <span className="text-xs tabular-nums text-muted">{sourceSheets.length} 张</span>
          </div>
          <Input aria-label="按文件名查找脸图" disabled={disabled} placeholder="按文件名查找" value={query} onChange={(event) => setQuery(event.target.value)} />
        </header>
        <div className="min-h-0 overflow-y-auto p-3">
          <div className="grid grid-cols-2 content-start items-start gap-3">
            {visibleSheets.map((sheet) => (
              <Button
                key={sheet.sha256}
                type="button"
                variant="ghost"
                aria-label={`选择整张脸图 ${sheet.file.name}${assignedHashes.has(sheet.sha256) ? "，已添加" : ""}`}
                aria-pressed={activeHash === sheet.sha256}
                disabled={busy}
                draggable={!busy}
                onClick={() => setActiveHash(sheet.sha256)}
                onDragStart={(event) => {
                  if (busy) { event.preventDefault(); return; }
                  dragHash.current = sheet.sha256;
                  setActiveHash(sheet.sha256);
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(FACE_SHEET_DRAG_TYPE, sheet.sha256);
                }}
                onDragEnd={endDrag}
                className={cn(
                  "relative grid h-auto min-w-0 cursor-grab justify-items-center gap-2 whitespace-normal rounded-md border border-border p-2 font-normal active:cursor-grabbing",
                  activeHash === sheet.sha256 && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <img alt="" src={sheet.src} width={sheet.width} height={sheet.height} draggable={false} loading="lazy" className="h-auto max-w-full select-none [image-rendering:pixelated]" />
                <span title={sheet.file.name} className="w-full truncate text-xs">{sheet.file.name}</span>
                {assignedHashes.has(sheet.sha256) ? <Check aria-hidden className="absolute right-1 top-1 rounded bg-primary text-primary-foreground" /> : null}
              </Button>
            ))}
          </div>
          {sourceLoading || sourcePreviews.loading ? <p role="status" className="text-sm text-muted">正在读取作品脸图…</p> : null}
          {!sourceLoading && !sourcePreviews.loading && !visibleSheets.length ? (
            <p className="py-4 text-center text-sm text-muted">
              {sourceSheets.length ? "没有匹配的文件名。" : "尚无可用脸图。选择游戏文件后自动读取 FaceSet，也可在右侧手动添加 PNG。"}
            </p>
          ) : null}
          {warnings.length ? (
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer">有 {warnings.length} 张脸图无法读取</summary>
              <ul className="mt-2 grid gap-1 break-words">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </details>
          ) : null}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
          <span className="text-xs text-muted">选中后添加，或将整张脸图拖到右侧。</span>
          <Button type="button" size="sm" variant="outline" disabled={busy || !activeSheet || assignedHashes.has(activeSheet.sha256)} onClick={() => activeSheet && addSheets([activeSheet])}>
            {activeSheet && assignedHashes.has(activeSheet.sha256) ? "已添加" : "添加选中脸图"}<ArrowRight className="size-4" />
          </Button>
        </footer>
      </section>
      <section
        aria-label="该角色的脸图"
        className={cn("grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]", dropActive && "bg-primary/5 ring-2 ring-inset ring-primary")}
        onDragOver={(event) => {
          if (busy || !dragHash.current || !event.dataTransfer.types.includes(FACE_SHEET_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropActive(true);
        }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropActive(false);
        }}
        onDrop={(event) => {
          const hash = dragHash.current;
          if (!hash) return;
          event.preventDefault();
          event.stopPropagation();
          if (!busy && event.dataTransfer.getData(FACE_SHEET_DRAG_TYPE) === hash) {
            const sheet = sourceSheets.find((item) => item.sha256 === hash);
            if (sheet) addSheets([sheet]);
          }
          endDrag();
        }}
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div><strong className="text-sm">该角色的脸图</strong><span className="ml-2 text-xs tabular-nums text-muted">{assignedHashes.size} 张</span></div>
          <Label className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer", busy && "pointer-events-none opacity-50")}>
            {adding ? "正在读取…" : "添加脸图"}
            <input type="file" accept="image/png" multiple disabled={busy} className="sr-only" onChange={(event) => {
              const nextFiles = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void addLocalFiles(nextFiles);
            }} />
          </Label>
          <p className="m-0 w-full text-xs text-muted">保留整张脸图，点击其中一格设为本作头像。</p>
        </header>
        <div className="min-h-0 overflow-y-auto p-3">
          {!assignedHashes.size ? <p className="grid min-h-24 place-content-center rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">将属于该角色的整张脸图拖到这里</p> : null}
          <div className="grid grid-cols-2 content-start items-start gap-3">
            {assignedSheets.map((sheet) => (
              <div key={sheet.sha256} className="min-w-0">
                <FaceSheetCanvas
                  label={`${sheet.file.name}，点击选择本作头像`}
                  src={sheet.src}
                  width={sheet.width}
                  height={sheet.height}
                  scale={1}
                  fit
                  disabled={busy}
                  selectedCell={draft.portrait?.blobSha256 === sheet.sha256 ? draft.portrait : null}
                  onSelectCell={(row, column) => setDraft((current) => ({ ...current, portrait: { blobSha256: sheet.sha256, row, column } }))}
                />
                <div className="mt-1 flex min-w-0 items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted" title={sheet.file.name}>{sheet.file.name}</span>
                  <Button type="button" size="icon" variant="ghost" className="size-6 min-h-0 shrink-0 p-0" disabled={busy} aria-label={`移除脸图 ${sheet.file.name}`} onClick={() => removeSheet(sheet.sha256)}><X className="size-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
          {error ? <p role="alert" className="whitespace-pre-wrap break-words text-xs text-red-700">{error}</p> : null}
          {assignedPreviews.errors.length ? <p role="alert" className="whitespace-pre-wrap break-words text-xs text-red-700">{assignedPreviews.errors.join("\n")}</p> : null}
        </div>
        <footer className="flex flex-wrap items-center gap-3 border-t border-border p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          <CharacterPortrait className="size-12 shrink-0 rounded" displayName={credit.selection.displayName} portrait={portrait} previewSrc={portraitSheet?.src} size={48} toneKey={credit.selection.originalName} />
          <div className="min-w-0 flex-1 text-xs text-muted" aria-live="polite">
            <strong className="block text-sm text-foreground">{portrait ? "本作头像" : "未选择头像"}</strong>
            {portrait ? `第 ${portrait.row + 1} 行，第 ${portrait.column + 1} 列` : "添加脸图后选择头像"}
          </div>
          <Button type="button" size="sm" disabled={busy || assignedPreviews.loading || assignedSheets.length !== assignedHashes.size} onClick={() => onConfirm(draft)}>确定</Button>
        </footer>
      </section>
    </div>
  );
}

function useFaceSheetPreviews(files: File[]) {
  const [state, setState] = useState<{ files: File[]; previews: Preview[]; errors: string[] } | null>(null);
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    void Promise.all(files.map(async (file) => {
      try {
        const sheet = await inspectCharacterFaceSheetFile(file);
        if (!active) return null;
        const src = URL.createObjectURL(file);
        urls.push(src);
        return { file, src, ...sheet };
      } catch (error) {
        return `${file.name}：${error instanceof Error ? error.message : "无法读取脸图。"}`;
      }
    })).then((results) => {
      if (!active) return;
      setState({
        files,
        previews: results.filter((result): result is Preview => result !== null && typeof result !== "string"),
        errors: results.filter((result): result is string => typeof result === "string"),
      });
    });
    return () => {
      active = false;
      urls.forEach((src) => URL.revokeObjectURL(src));
    };
  }, [files]);
  return {
    previews: state?.files === files ? state.previews : [],
    errors: state?.files === files ? state.errors : [],
    loading: state?.files !== files,
  };
}
