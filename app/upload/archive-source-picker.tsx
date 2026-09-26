import { Notice } from "@/app/components/ui/notice";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { Label } from "@/app/components/ui/label";
import { Progress } from "@/app/components/ui/progress";
import { normalizeArchivePath } from "@/lib/archive/file-policy";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import {
  ChevronDown,
  FileArchive,
  FolderOpen,
  LoaderCircle,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { Popover } from "radix-ui";
import type { ChangeEvent, DragEvent, RefObject } from "react";
import { useId, useRef, useState } from "react";
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
  cleanupResources,
  onCleanupResourcesChange,
  useSharedPlayer,
  onUseSharedPlayerChange,
  disabled,
  existingSource = null,
  mode,
  onCancel,
  onDrop,
  onFolder,
  onRemoveExisting,
  onRestart,
  onArchive,
  sourceSummary,
  task,
}: {
  canceling: boolean;
  cleanupResources: boolean;
  useSharedPlayer: boolean;
  onUseSharedPlayerChange: (value: boolean) => void;
  onCleanupResourcesChange: (value: boolean) => void;
  disabled: boolean;
  existingSource?: ArchiveSourceSummary | null;
  mode: UploadSourceKind;
  onCancel: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFolder: (files: UploadSourceFile[], sourceName: string) => void;
  onRemoveExisting?: () => void;
  onRestart: () => void;
  onArchive: (file: File) => void;
  sourceSummary: ArchiveSourceSummary | null;
  task: BrowserUploadTaskSnapshot | null;
}) {
  const dragDepthRef = useRef(0);
  const instructionsId = useId();
  const [fileDragActive, setFileDragActive] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement>(null);

  function openArchivePicker() {
    if (!disabled) archiveInputRef.current?.click();
  }

  function resetFileDrag() {
    dragDepthRef.current = 0;
    setFileDragActive(false);
  }

  return (
    <div>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-bold">游戏文件</h2>
        <ArchiveAdvancedOptions
          cleanupResources={cleanupResources}
          disabled={disabled}
          onCleanupResourcesChange={onCleanupResourcesChange}
          onUseSharedPlayerChange={onUseSharedPlayerChange}
          task={sourceSummary ? task : null}
          useSharedPlayer={useSharedPlayer}
        />
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
          aria-label={
            fileDragActive
              ? "松开以上传游戏文件"
              : "拖入游戏文件夹、ZIP 或 7z 压缩包"
          }
          className={cn(
            "grid min-h-52 place-items-center rounded-lg border-2 border-dashed border-border bg-background p-5 text-center transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:border-primary hover:bg-primary/5",
            fileDragActive &&
              !disabled &&
              "border-primary bg-primary/10 ring-2 ring-primary/20",
          )}
          data-file-drag-active={fileDragActive || undefined}
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && event.currentTarget.contains(target) &&
                !target.closest("button, [data-upload-picker]")) openArchivePicker();
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
          role="group"
        >
          <div className="grid w-full justify-items-center gap-2">
            <Button
              aria-describedby={instructionsId}
              className="grid min-h-0 w-full justify-items-center whitespace-normal p-0 text-base font-normal hover:bg-transparent [&_svg]:size-8"
              disabled={disabled}
              onClick={openArchivePicker}
              type="button"
              variant="ghost"
            >
              <Upload className="size-8 text-primary" />
              <strong aria-live="polite">
                {fileDragActive ? "松开以上传" : "拖入游戏文件夹、ZIP 或 7z 压缩包"}
              </strong>
              <span className="text-sm text-muted" id={instructionsId}>
                文件夹根目录或压缩包内须包含 RPG_RT.lmt
              </span>
            </Button>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <FilePicker
                accept=".zip,.7z,application/zip,application/x-7z-compressed"
                disabled={disabled}
                inputRef={archiveInputRef}
                label="选择 ZIP / 7z"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onArchive(file);
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
                  onFolder(
                    files.map((file) => ({
                      file,
                      relativePath: webkitPath(file),
                    })),
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

function ArchiveAdvancedOptions({
  cleanupResources,
  disabled,
  onCleanupResourcesChange,
  onUseSharedPlayerChange,
  task,
  useSharedPlayer,
}: {
  cleanupResources: boolean;
  disabled: boolean;
  onCleanupResourcesChange: (value: boolean) => void;
  onUseSharedPlayerChange: (value: boolean) => void;
  task: BrowserUploadTaskSnapshot | null;
  useSharedPlayer: boolean;
}) {
  const cleanupResourcesId = useId();
  const sharedPlayerId = useId();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          className="group gap-1.5 text-muted data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
          size="sm"
          type="button"
          variant="ghost"
        >
          <SlidersHorizontal aria-hidden />
          高级选项
          <ChevronDown aria-hidden className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          aria-label="游戏文件高级选项"
          className="z-50 w-96 max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-3 text-card-foreground shadow-surface data-[side=top]:[--popover-slide-offset:0.5rem] motion-safe:data-[state=open]:animate-popover-slide-open motion-safe:data-[state=closed]:animate-popover-slide-closed"
          collisionPadding={12}
          side="bottom"
          sideOffset={6}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">高级选项</h3>
            <Popover.Close asChild>
              <Button
                aria-label="关闭高级选项"
                className="size-7 text-muted pointer-coarse:size-9"
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden />
              </Button>
            </Popover.Close>
          </div>
          <div className="grid gap-1">
            <div className="flex min-h-7 items-center gap-2" data-resource-cleanup-option>
              <Checkbox
                checked={cleanupResources}
                disabled={disabled}
                id={cleanupResourcesId}
                onCheckedChange={(checked) => onCleanupResourcesChange(checked === true)}
              />
              <Label className="flex-1 py-1.5" htmlFor={cleanupResourcesId}>清理未引用素材</Label>
              <InfoTooltip>排除游戏未使用的素材，减小上传与下载体积。</InfoTooltip>
            </div>
            <div className="flex min-h-7 items-center gap-2">
              <Checkbox
                checked={useSharedPlayer}
                disabled={disabled}
                id={sharedPlayerId}
                onCheckedChange={(checked) => onUseSharedPlayerChange(checked === true)}
              />
              <Label className="flex-1 py-1.5" htmlFor={sharedPlayerId}>使用共享EasyRPG</Label>
              <InfoTooltip>移除根目录中的Player.exe，下载时使用最新的EasyRPG Player Kai。</InfoTooltip>
            </div>
          </div>
          <UploadCleanupLog task={task} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function UploadCleanupLog({ task }: { task: BrowserUploadTaskSnapshot | null }) {
  const headingId = useId();
  const cleanup = task?.stats.resourceCleanup;
  const sharedPlayer = task?.stats.sharedPlayer;
  const files = [
    ...(sharedPlayer ? [{ ...sharedPlayer, reason: "共享播放器" }] : []),
    ...(cleanup?.excluded.map((file) => ({ ...file, reason: "未引用素材" })) ?? []),
  ];
  const excludedSize = files.reduce((sum, file) => sum + file.size, 0);
  const summary = files.length
    ? `已排除 ${files.length} 个文件 · 减少 ${formatBytes(excludedSize)}`
    : cleanup?.status === "no_candidates"
      ? "未发现可分析的素材"
      : cleanup?.status === "preserved"
        ? "无法完整判断，已保留全部素材"
        : cleanup
          ? "素材检查完成，没有需要清理的文件"
          : task?.sourceReady
            ? "本次上传没有清理记录"
            : task
              ? "文件检查完成后显示清理记录"
              : "选择文件后，清理记录会显示在这里";

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 border-t border-border pt-3"
      data-resource-cleanup={cleanup?.status}
    >
      <h3 className="text-sm font-semibold" id={headingId}>清理日志</h3>
      <p aria-live="polite" className="mt-1 text-xs text-muted">{summary}</p>
      {files.length || cleanup?.reasons.length ? (
        <div
          aria-label="清理日志明细"
          className="mt-2 max-h-48 overflow-auto overscroll-contain rounded-sm text-xs"
          role="region"
          tabIndex={0}
        >
          <ul className="grid gap-1 whitespace-nowrap">
            {cleanup?.reasons.map((reason) => (
              <li className="min-w-max text-muted" key={reason}>{reason}</li>
            ))}
            {files.map((file) => (
              <li className="flex min-w-max items-center gap-3" key={file.path}>
                <span className="flex-1">{file.path}</span>
                <span className="text-muted">{file.reason}</span>
                <span className="text-muted tabular-nums">{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
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
              本站归档 · {source.fileCount.toLocaleString("zh-CN")} 个文件 ·{" "}
              {formatBytes(source.sizeBytes)}
            </span>
          </span>
          <strong className="font-mono text-lg">100%</strong>
        </div>
        <Progress
          aria-label="现有游戏文件已就绪"
          className="mt-4"
          value={100}
        />
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
    task &&
      ["running", "waiting"].includes(task.status) &&
      task.phase !== "committing",
  );
  const showCancel = canceling || canCancel;
  const canRestart = Boolean(
    !canceling &&
      task &&
      ["failed", "canceled"].includes(task.status),
  );

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="p-4">
        <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary">
            {mode === "folder" ? (
              <FolderOpen className="size-5" />
            ) : (
              <FileArchive className="size-5" />
            )}
          </span>
          <span className="min-w-0">
            <strong className="block truncate">{sourceSummary.name}</strong>
            <span className="mt-0.5 block text-xs text-muted">
              {mode === "folder" ? "文件夹" : mode === "7z" ? "7z 压缩包" : "ZIP 压缩包"} ·{" "}
              {sourceSummary.fileCount.toLocaleString("zh-CN")} 个文件 ·{" "}
              {formatBytes(sourceSummary.sizeBytes)}
            </span>
          </span>
          <strong className="font-mono text-lg">{Math.round(progress)}%</strong>
        </div>
        <Progress
          aria-label="游戏文件处理、上传与校验进度"
          className="mt-4"
          value={progress}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <strong>{progressLabel}</strong>
          {task?.progress.currentPath ? (
            <span className="max-w-full truncate font-mono">
              {task.progress.currentPath}
            </span>
          ) : null}
        </div>
        {task?.error ? (
          <Notice tone="error" className="mt-3 border p-3 text-sm" role="alert">
            {task.error}
          </Notice>
        ) : null}
      </div>
      {showCancel || canRestart ? (
        <footer className="flex justify-end gap-2 border-t border-border bg-background/60 px-4 py-3">
          {showCancel ? (
            <Button
              aria-busy={canceling}
              disabled={canceling}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="outline"
            >
              {canceling ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : null}
              {canceling ? "取消中" : "取消上传"}
            </Button>
          ) : null}
          {canRestart ? (
            <Button onClick={onRestart} size="sm" type="button">
              重新开始
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

export function normalizeFolderSource(
  rawFiles: UploadSourceFile[],
  suggestedName: string,
) {
  if (!rawFiles.length) throw new Error("文件夹中没有可读取的文件。");
  const normalized = rawFiles.map((item) => ({
    ...item,
    relativePath: normalizeArchivePath(item.relativePath),
  }));
  const firstParts = normalized[0].relativePath.split("/");
  const commonRoot = firstParts.length > 1 ? firstParts[0] : null;
  const strip =
    commonRoot &&
    normalized.every((item) => item.relativePath.startsWith(`${commonRoot}/`));
  const files = normalized.map((item) => ({
    ...item,
    relativePath: strip
      ? item.relativePath.split("/").slice(1).join("/")
      : item.relativePath,
  }));
  return { sourceName: suggestedName || commonRoot || "local-folder", files };
}

export async function readDroppedFolder(
  dataTransfer: DataTransfer,
): Promise<{ sourceName: string; files: UploadSourceFile[] }> {
  const entries = Array.from(dataTransfer.items)
    .map((item): DroppedEntry | null => {
      const getEntry = (
        item as unknown as { webkitGetAsEntry?: () => DroppedEntry | null }
      ).webkitGetAsEntry;
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
  return {
    sourceName: folderNameFromPicker(Array.from(dataTransfer.files)),
    files,
  };
}

async function readDroppedEntry(
  entry: DroppedEntry,
  path: string,
): Promise<UploadSourceFile[]> {
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
  file: (
    resolve: (file: File) => void,
    reject: (error: DOMException) => void,
  ) => void;
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
  return (
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name
  );
}

function folderNameFromPicker(files: File[]): string {
  const first = files[0] ? webkitPath(files[0]).split("/")[0] : "local-folder";
  return first || "local-folder";
}

export function uploadPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    enumerating: "读取文件",
    hashing: "校验文件",
    analyzing_resources: "检查素材引用",
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
