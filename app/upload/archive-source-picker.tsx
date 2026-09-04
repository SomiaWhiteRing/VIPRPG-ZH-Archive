"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type DragEvent,
  type RefObject,
  useId,
  useRef,
  useState,
} from "react";
import { FileArchive, FolderOpen, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Progress } from "@/app/components/ui/progress";
import { normalizeArchivePath } from "@/lib/archive/file-policy";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import type {
  BrowserUploadTaskSnapshot,
  UploadSourceFile,
  UploadSourceKind,
} from "./upload-types";

export type ArchiveSourceSummary = {
  name: string;
  fileCount: number;
  sizeBytes: number;
};

export function ArchiveSourcePicker({
  canceling,
  disabled,
  existingSource = null,
  mode,
  onCancel,
  onDrop,
  onFolder,
  onModeChange,
  onRemoveExisting,
  onRestart,
  onZip,
  sourceSummary,
  task,
}: {
  canceling: boolean;
  disabled: boolean;
  existingSource?: ArchiveSourceSummary | null;
  mode: UploadSourceKind;
  onCancel: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFolder: (files: UploadSourceFile[], sourceName: string) => void;
  onModeChange: (mode: UploadSourceKind) => void;
  onRemoveExisting?: () => void;
  onRestart: () => void;
  onZip: (file: File) => void;
  sourceSummary: ArchiveSourceSummary | null;
  task: BrowserUploadTaskSnapshot | null;
}) {
  const dragDepthRef = useRef(0);
  const instructionsId = useId();
  const [fileDragActive, setFileDragActive] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  function openZipPicker() {
    if (!disabled) zipInputRef.current?.click();
  }

  function resetFileDrag() {
    dragDepthRef.current = 0;
    setFileDragActive(false);
  }

  return (
    <div>
      <header className="mb-4">
        <h2 className="m-0 text-lg font-bold">游戏文件</h2>
      </header>
      {sourceSummary ? (
        <UploadTaskCard
          canceling={canceling}
          mode={mode}
          onCancel={onCancel}
          onRestart={onRestart}
          sourceSummary={sourceSummary}
          task={task}
        />
      ) : existingSource ? (
        <ExistingArchiveCard
          onRemove={onRemoveExisting}
          source={existingSource}
        />
      ) : (
        <div
          aria-describedby={instructionsId}
          aria-disabled={disabled || undefined}
          aria-label={fileDragActive ? "松开以上传游戏文件" : "拖入游戏文件夹或 ZIP 压缩包"}
          className={cn(
            "grid min-h-52 place-items-center rounded-lg border-2 border-dashed border-border bg-background p-5 text-center transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:border-primary hover:bg-primary/5",
            fileDragActive && !disabled && "border-primary bg-primary/10 ring-2 ring-primary/20",
          )}
          data-file-drag-active={fileDragActive || undefined}
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("[data-upload-picker]")) return;
            openZipPicker();
          }}
          onDragEnter={(event) => {
            if (!hasDraggedFiles(event)) return;
            event.preventDefault();
            if (disabled) return;
            dragDepthRef.current += 1;
            setFileDragActive(true);
          }}
          onDragLeave={() => {
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setFileDragActive(false);
          }}
          onDragOver={(event) => {
            if (!hasDraggedFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = disabled ? "none" : "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const hasFiles = hasDraggedFiles(event);
            resetFileDrag();
            if (!disabled && hasFiles) void onDrop(event);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            openZipPicker();
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
        >
          <div className="grid justify-items-center gap-2">
            <Upload className="size-8 text-primary" />
            <strong aria-live="polite">
              {fileDragActive ? "松开以上传" : "拖入游戏文件夹或 ZIP 压缩包"}
            </strong>
            <span className="text-sm text-muted" id={instructionsId}>
              文件夹根目录或 ZIP 内须包含 RPG_RT.lmt
            </span>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <FilePicker
                accept=".zip,application/zip"
                disabled={disabled}
                inputRef={zipInputRef}
                label="选择 ZIP"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onModeChange("zip");
                    onZip(file);
                  }
                }}
              />
              <FilePicker
                directory
                disabled={disabled}
                label="以文件夹方式选择"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  onModeChange("folder");
                  onFolder(
                    files.map((file) => ({ file, relativePath: webkitPath(file) })),
                    folderNameFromPicker(files),
                  );
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExistingArchiveCard({
  onRemove,
  source,
}: {
  onRemove?: () => void;
  source: ArchiveSourceSummary;
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="p-4">
        <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary">
            <FileArchive className="size-5" />
          </span>
          <span className="min-w-0">
            <strong className="block truncate">{source.name}</strong>
            <span className="mt-0.5 block text-xs text-muted">
              本站归档 · {source.fileCount.toLocaleString("zh-CN")} 个文件 · {formatBytes(source.sizeBytes)}
            </span>
          </span>
          <strong className="font-mono text-lg">100%</strong>
        </div>
        <Progress aria-label="现有游戏文件已就绪" className="mt-4" value={100} />
        <div className="mt-2 text-xs text-muted">
          <strong>游戏文件已就绪</strong>
        </div>
      </div>
      {onRemove ? (
        <footer className="flex justify-end border-t border-border bg-background/60 px-4 py-3">
          <Button onClick={onRemove} size="sm" type="button" variant="outline">
            移除
          </Button>
        </footer>
      ) : null}
    </article>
  );
}

function UploadTaskCard({
  canceling,
  mode,
  onCancel,
  onRestart,
  sourceSummary,
  task,
}: {
  canceling: boolean;
  mode: UploadSourceKind;
  onCancel: () => void;
  onRestart: () => void;
  sourceSummary: ArchiveSourceSummary;
  task: BrowserUploadTaskSnapshot | null;
}) {
  const progress = Math.min(100, task?.progress.percent ?? 0);
  const progressLabel = task?.sourceReady
    ? "游戏文件已就绪"
    : task
      ? uploadPhaseLabel(task.phase)
      : "准备上传";
  const canCancel = Boolean(
    task && ["running", "waiting"].includes(task.status) && task.phase !== "committing",
  );
  const showCancel = canceling || canCancel;
  const canRestart = Boolean(
    !canceling && task && (["failed", "canceled"].includes(task.status) || task.result),
  );

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="p-4">
        <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary">
            {mode === "folder" ? <FolderOpen className="size-5" /> : <FileArchive className="size-5" />}
          </span>
          <span className="min-w-0">
            <strong className="block truncate">{sourceSummary.name}</strong>
            <span className="mt-0.5 block text-xs text-muted">
              {mode === "folder" ? "文件夹" : "ZIP 压缩包"} · {sourceSummary.fileCount.toLocaleString("zh-CN")} 个文件 · {formatBytes(sourceSummary.sizeBytes)}
            </span>
          </span>
          <strong className="font-mono text-lg">{Math.round(progress)}%</strong>
        </div>
        <Progress aria-label="游戏文件处理、上传与校验进度" className="mt-4" value={progress} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <strong>{progressLabel}</strong>
          {task?.progress.currentPath ? <span className="max-w-full truncate font-mono">{task.progress.currentPath}</span> : null}
        </div>
        {task?.error ? <p className="mt-3 border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{task.error}</p> : null}
        {task?.result ? (
          <p className="mt-3 border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            上传完成。
            <Link className="font-semibold underline" href={`/games/${task.result.workId}`}>查看作品</Link>
          </p>
        ) : null}
      </div>
      {showCancel || canRestart ? (
        <footer className="flex justify-end gap-2 border-t border-border bg-background/60 px-4 py-3">
          {showCancel ? (
            <Button aria-busy={canceling} disabled={canceling} onClick={onCancel} size="sm" type="button" variant="outline">
              {canceling ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
              {canceling ? "取消中" : "取消上传"}
            </Button>
          ) : null}
          {canRestart ? (
            <Button onClick={onRestart} size="sm" type="button">
              {task?.result ? "上传其他版本" : "重新开始"}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

function FilePicker({
  accept,
  directory = false,
  disabled = false,
  inputRef,
  label,
  multiple = false,
  onChange,
}: {
  accept?: string;
  directory?: boolean;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  label: string;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const id = useId();
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const controlRef = inputRef ?? fallbackInputRef;

  return (
    <div data-upload-picker>
      <Button
        aria-controls={id}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          controlRef.current?.click();
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {label}
      </Button>
      <input
        accept={accept}
        disabled={disabled}
        hidden
        id={id}
        multiple={multiple}
        onChange={onChange}
        ref={controlRef}
        type="file"
        {...(directory ? { webkitdirectory: "", directory: "" } : {})}
      />
    </div>
  );
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function normalizeFolderSource(rawFiles: UploadSourceFile[], suggestedName: string) {
  if (!rawFiles.length) throw new Error("文件夹中没有可读取的文件。");
  const normalized = rawFiles.map((item) => ({
    ...item,
    relativePath: normalizeArchivePath(item.relativePath),
  }));
  const firstParts = normalized[0].relativePath.split("/");
  const commonRoot = firstParts.length > 1 ? firstParts[0] : null;
  const strip = commonRoot && normalized.every((item) => item.relativePath.startsWith(`${commonRoot}/`));
  const files = normalized.map((item) => ({
    ...item,
    relativePath: strip ? item.relativePath.split("/").slice(1).join("/") : item.relativePath,
  }));
  return { sourceName: suggestedName || commonRoot || "local-folder", files };
}

export async function readDroppedFolder(
  dataTransfer: DataTransfer,
): Promise<{ sourceName: string; files: UploadSourceFile[] }> {
  const entries = Array.from(dataTransfer.items)
    .map((item): DroppedEntry | null => {
      const getEntry = (item as unknown as { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry;
      return getEntry?.call(item) ?? null;
    })
    .filter((entry): entry is DroppedEntry => entry !== null);
  if (entries.length === 1 && entries[0].isDirectory) {
    const files = await readDroppedEntry(entries[0], entries[0].name);
    return { sourceName: entries[0].name, files };
  }
  const files = Array.from(dataTransfer.files).map((file) => ({
    file,
    relativePath: webkitPath(file),
  }));
  return { sourceName: folderNameFromPicker(Array.from(dataTransfer.files)), files };
}

async function readDroppedEntry(entry: DroppedEntry, path: string): Promise<UploadSourceFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as DroppedFileEntry).file(resolve, reject),
    );
    return [{ file, relativePath: path }];
  }
  const reader = (entry as DroppedDirectoryEntry).createReader();
  const children: DroppedEntry[] = [];
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(
    children.map((child) => readDroppedEntry(child, `${path}/${child.name}`)),
  );
  return nested.flat();
}

type DroppedEntry = { isFile: boolean; isDirectory: boolean; name: string };
type DroppedFileEntry = DroppedEntry & {
  file: (resolve: (file: File) => void, reject: (error: DOMException) => void) => void;
};
type DroppedDirectoryEntry = DroppedEntry & {
  createReader: () => {
    readEntries: (
      resolve: (entries: DroppedEntry[]) => void,
      reject: (error: DOMException) => void,
    ) => void;
  };
};

function webkitPath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function folderNameFromPicker(files: File[]): string {
  const first = files[0] ? webkitPath(files[0]).split("/")[0] : "local-folder";
  return first || "local-folder";
}

export function uploadPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    enumerating: "读取文件",
    hashing: "校验文件",
    building_core_pack: "整理公共文件",
    creating_import_job: "创建上传任务",
    preflighting: "检查已有对象",
    uploading_source: "上传游戏文件",
    verifying_source: "服务器校验游戏文件",
    awaiting_metadata: "等待作品资料",
    uploading_metadata: "上传资料图片",
    committing: "提交入库",
    completed: "完成",
  };
  return labels[phase] ?? "准备";
}
