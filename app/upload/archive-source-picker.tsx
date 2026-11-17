import { UiFeedbackError } from "@/lib/i18n/feedback";
import { isMessageKey, type MessageKey } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
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
import * as Popover from "@/app/components/ui/popover";
import { type ChangeEvent, type DragEvent, type RefObject, type ReactNode, useId, useRef, useState } from "react";

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
  additionalActions,
  checkMissingResources,
  onCheckMissingResourcesChange,
  useSharedPlayer,
  onUseSharedPlayerChange,
  disabled,
  externalDisabled = false,
  existingSource = null,
  mode,
  onCancel,
  onDrop,
  onExternal,
  onFolder,
  onRemoveExisting,
  onRestart,
  onArchive,
  sourceSummary,
  task,
}: {
  canceling: boolean;
  additionalActions?: ReactNode;
  checkMissingResources: boolean;
  onCheckMissingResourcesChange: (value: boolean) => void;
  useSharedPlayer: boolean;
  onUseSharedPlayerChange: (value: boolean) => void;
  disabled: boolean;
  externalDisabled?: boolean;
  existingSource?: ArchiveSourceSummary | null;
  mode: UploadSourceKind;
  onCancel: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onExternal?: () => void;
  onFolder: (files: UploadSourceFile[], sourceName: string) => void;
  onRemoveExisting?: () => void;
  onRestart: () => void;
  onArchive: (file: File) => void;
  sourceSummary: ArchiveSourceSummary | null;
  task: BrowserUploadTaskSnapshot | null;
}) {
  const dragDepthRef = useRef(0);
  const instructionsId = useId();
  const t = useMessages();
  const [fileDragActive, setFileDragActive] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const allActionsDisabled = disabled && (!onExternal || externalDisabled);

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
        <h2 className="m-0 text-lg font-bold">{t("upload.files")}</h2>
        <ArchiveAdvancedOptions
          checkMissingResources={checkMissingResources}
          onCheckMissingResourcesChange={onCheckMissingResourcesChange}
          disabled={disabled}
          onUseSharedPlayerChange={onUseSharedPlayerChange}
          task={sourceSummary ? task : null}
          useSharedPlayer={useSharedPlayer}
        />
      </header>
      {sourceSummary ? (
        <UploadTaskCard
          additionalActions={additionalActions}
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
          aria-disabled={allActionsDisabled || undefined}
          aria-label={
            fileDragActive
              ? t("upload.picker.releaseFiles")
              : t("upload.picker.dropFiles")
          }
          className={cn(
            "grid min-h-52 place-items-center rounded-lg border-2 border-dashed border-border bg-background p-5 text-center transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            disabled
              ? allActionsDisabled ? "cursor-not-allowed opacity-60" : "cursor-default"
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
                {fileDragActive ? t("upload.picker.release") : t("upload.picker.dropFiles")}
              </strong>
              <span className="text-sm text-muted" id={instructionsId}>
                {t("upload.picker.lmt")}
              </span>
            </Button>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <FilePicker
                accept=".zip,.7z,application/zip,application/x-7z-compressed"
                disabled={disabled}
                inputRef={archiveInputRef}
                label={t("upload.picker.archive")}
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
                label={t("upload.picker.folder")}
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
              {onExternal ? (
                <Button
                  disabled={externalDisabled}
                  onClick={onExternal}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("upload.picker.external")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArchiveAdvancedOptions({
  checkMissingResources,
  onCheckMissingResourcesChange,
  disabled,
  onUseSharedPlayerChange,
  task,
  useSharedPlayer,
}: {
  checkMissingResources: boolean;
  onCheckMissingResourcesChange: (value: boolean) => void;
  disabled: boolean;
  onUseSharedPlayerChange: (value: boolean) => void;
  task: BrowserUploadTaskSnapshot | null;
  useSharedPlayer: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const sharedPlayerId = useId();
  const t = useMessages();
  const missingResourcesId = useId();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          ref={trigger}
          className="group gap-1.5 text-muted data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
          size="sm"
          type="button"
          variant="ghost"
        >
          <SlidersHorizontal aria-hidden />
          {t("upload.picker.advanced")}
          <ChevronDown aria-hidden className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal anchorRef={trigger}>
        <Popover.Content
          align="end"
          aria-label={t("upload.picker.advancedNamed")}
          className="z-50 w-96 max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-3 text-card-foreground shadow-surface data-[side=top]:[--popover-slide-offset:0.5rem] motion-safe:data-[state=open]:animate-popover-slide-open motion-safe:data-[state=closed]:animate-popover-slide-closed"
          collisionPadding={12}
          side="bottom"
          sideOffset={6}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{t("upload.picker.advanced")}</h3>
            <Popover.Close asChild>
              <Button
                aria-label={t("upload.picker.closeAdvanced")}
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
            <div className="flex min-h-7 items-center gap-2">
              <Checkbox
                checked={checkMissingResources}
                disabled={disabled}
                id={missingResourcesId}
                onCheckedChange={(checked) => onCheckMissingResourcesChange(checked === true)}
              />
              <Label className="flex-1 py-1.5" htmlFor={missingResourcesId}>{t("upload.picker.detect")}</Label>
              <InfoTooltip>{t("upload.picker.detectHelp")}</InfoTooltip>
            </div>

            <div className="flex min-h-7 items-center gap-2">
              <Checkbox
                checked={useSharedPlayer}
                disabled={disabled}
                id={sharedPlayerId}
                onCheckedChange={(checked) => onUseSharedPlayerChange(checked === true)}
              />
              <Label className="flex-1 py-1.5" htmlFor={sharedPlayerId}>{t("upload.picker.shared")}</Label>
              <InfoTooltip>{t("upload.picker.sharedHelp")}</InfoTooltip>
            </div>

          </div>
          <UploadDetectionLog task={task} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function UploadDetectionLog({ task }: { task: BrowserUploadTaskSnapshot | null }) {
  const t = useMessages();
  const headingId = useId();
  const missing = task?.stats.missingResources;
  const sharedPlayer = task?.stats.sharedPlayer;
  const restoredRtpFiles = task?.stats.restoredRtpFiles ?? [];
  const summary = !missing ? t("upload.picker.noResult")
    : missing.missing.length ? t("upload.picker.missingCount", { count: missing.missing.length })
      : missing.limited || missing.reasons.length ? t("upload.picker.seeDetails") : t("upload.picker.noneMissing");
  return (
    <section aria-labelledby={headingId} className="mt-3 border-t border-border pt-3">
      <h3 className="text-sm font-semibold" id={headingId}>{t("upload.picker.log")}</h3>
      <p aria-live="polite" className="mt-1 text-xs text-muted">{summary}</p>
      {sharedPlayer || restoredRtpFiles.length > 0 || (missing && (missing.missing.length > 0 || missing.reasons.length > 0 || missing.limited)) ? (
        <div aria-label={t("upload.picker.logDetails")} className="mt-2 max-h-48 overflow-auto overscroll-contain rounded-sm text-xs" role="region" tabIndex={0}>
          <ul className="grid gap-1 whitespace-nowrap">
            {missing?.missing.map(file => (
              <li className="min-w-max text-red-600 dark:text-red-300" key={file.path}>{t("upload.picker.missingNamed", { path: file.path, source: file.source })}</li>
            ))}
            {missing?.reasons.map(reason => (
              <li className="min-w-max text-red-600 dark:text-red-300" key={reason}>{reason}</li>
            ))}
            {missing?.limited ? <li className="min-w-max text-red-600 dark:text-red-300">{t("upload.picker.limited")}</li> : null}
            {sharedPlayer ? <li className="min-w-max text-muted">{t("upload.picker.playerReplaced", { path: sharedPlayer.path, size: formatBytes(sharedPlayer.size) })}</li> : null}
            {restoredRtpFiles.map(file => (
              <li className="min-w-max text-blue-600 dark:text-blue-300" key={`rtp:${file.path}`}>{t("upload.picker.rtp", { path: file.path })}</li>
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
  const t = useMessages();
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
              {t("upload.picker.sourceSummary", { kind: t("upload.picker.archiveType"), count: source.fileCount, size: formatBytes(source.sizeBytes) })}
            </span>
          </span>
          <strong className="font-mono text-lg">100%</strong>
        </div>
        <Progress
          aria-label={t("upload.picker.existingReady")}
          className="mt-4"
          value={100}
        />
        <div className="mt-2 text-xs text-muted">
          <strong>{t("upload.picker.filesReady")}</strong>
        </div>
      </div>
      {onRemove ? (
        <footer className="flex justify-end border-t border-border bg-background/60 px-4 py-3">
          <Button onClick={onRemove} size="sm" type="button" variant="outline">
            {t("upload.picker.remove")}
          </Button>
        </footer>
      ) : null}
    </article>
  );
}

function UploadTaskCard({
  additionalActions,
  canceling,
  mode,
  onCancel,
  onRestart,
  sourceSummary,
  task,
}: {
  additionalActions?: ReactNode;
  canceling: boolean;
  mode: UploadSourceKind;
  onCancel: () => void;
  onRestart: () => void;
  sourceSummary: ArchiveSourceSummary;
  task: BrowserUploadTaskSnapshot | null;
}) {
  const t = useMessages();
  const progress = Math.min(100, task?.progress.percent ?? 0);
  const reason = task?.errorMessage ? t(task.errorMessage.key, task.errorMessage.values) : task?.terminalPending?.reason ?? task?.error;
  const taskError = task?.terminalPending && reason
    ? t(task.terminalPending.key, { reason })
    : reason;
  const missing = task?.stats.missingResources;
  const progressLabel = task?.extrasBusy && task.commitStarted
    ? t("upload.picker.extraProgress", { done: task.extrasProgress?.completed ?? 0, total: task.extrasProgress?.total ?? 0 })
    : task?.sourceReady
    ? t("upload.picker.filesReady")
    : task
      ? uploadPhaseLabel(task.phase, t)
      : t("upload.picker.prepareUpload");
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
              {t("upload.picker.sourceSummary", {
                kind: t(mode === "folder" ? "upload.picker.typeFolder" : mode === "7z" ? "upload.picker.type7z" : "upload.picker.typeZip"),
                count: sourceSummary.fileCount,
                size: formatBytes(sourceSummary.sizeBytes),
              })}
            </span>
          </span>
          <strong className="font-mono text-lg">{Math.round(progress)}%</strong>
        </div>
        <Progress
          aria-label={t("upload.picker.progress")}
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
        {missing && (missing.missing.length > 0 || missing.limited) ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-300" role="status">
            {t("upload.picker.missingHint", {
              summary: missing.missing.length
                ? t("upload.picker.missingCount", { count: missing.missing.length })
                : t("upload.picker.incomplete"),
            })}
          </p>
        ) : null}
        {taskError ? (
          <Notice tone="error" className="mt-3 whitespace-pre-line border p-3 text-sm" role="alert">
            {taskError}
          </Notice>
        ) : null}
      </div>
      {showCancel || canRestart || additionalActions ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/60 px-4 py-3">
          {additionalActions}
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
              ) : <X aria-hidden />}
              {canceling ? t("upload.picker.canceling") : t("upload.picker.cancel")}
            </Button>
          ) : null}
          {canRestart ? (
            <Button onClick={onRestart} size="sm" type="button">
              {t("upload.picker.restart")}
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
  if (!rawFiles.length) throw new UiFeedbackError("upload.picker.emptyFolder");
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

export function uploadPhaseLabel(phase: string, t: (key: MessageKey) => string): string {
  const key = `upload.phase.${phase}`;
  return t(isMessageKey(key) ? key : "upload.phase.fallback");
}
