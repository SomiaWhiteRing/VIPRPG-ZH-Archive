"use client";
import { Button } from "@/app/components/ui/button";
import { Progress } from "@/app/components/ui/progress";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import type {
  BrowserUploadTaskSnapshot,
  UploadSourceKind,
  MetadataBlobUpload,
  UploadWorkerInput,
  UploadWorkerOutput,
} from "@/app/upload/upload-types";
import { formatBytes } from "@/lib/format";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";

type StartUploadInput = {
  sourceKind: UploadSourceKind;
  files: File[];
  metadata: ArchiveCommitMetadata;
  metadataBlobs: MetadataBlobUpload[];
};

type UploadTaskContextValue = {
  tasks: BrowserUploadTaskSnapshot[];
  startUpload: (input: StartUploadInput) => void;
  pauseTask: (localTaskId: string) => void;
  resumeTask: (localTaskId: string) => void;
  cancelTask: (localTaskId: string) => void;
  clearTask: (localTaskId: string) => void;
};

const UploadTaskContext = createContext<UploadTaskContextValue | null>(null);

export function UploadTaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<BrowserUploadTaskSnapshot[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const hasActiveTask = tasks.some((task) => ["running", "paused"].includes(task.status));

    if (!hasActiveTask) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [tasks]);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current;
    }

    const worker = new Worker(new URL("./upload-worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<UploadWorkerOutput>) => {
      const data = event.data;

      if (data.type === "task") {
        setTasks((current) => upsertTask(current, data.task));
      }
    };
    workerRef.current = worker;

    return worker;
  }, []);

  const startUpload = useCallback(
    (input: StartUploadInput) => {
      const worker = ensureWorker();
      const localTaskId = crypto.randomUUID();

      worker.postMessage({
        type: "start",
        localTaskId,
        sourceKind: input.sourceKind,
        files: input.files,
        metadata: input.metadata,
        metadataBlobs: input.metadataBlobs,
      } satisfies UploadWorkerInput);
      setPanelOpen(true);
    },
    [ensureWorker],
  );

  const pauseTask = useCallback((localTaskId: string) => {
    workerRef.current?.postMessage({
      type: "pause",
      localTaskId,
    } satisfies UploadWorkerInput);
    setTasks((current) =>
      current.map((task) =>
        task.localTaskId === localTaskId ? { ...task, status: "paused", updatedAt: new Date().toISOString() } : task,
      ),
    );
  }, []);

  const resumeTask = useCallback((localTaskId: string) => {
    workerRef.current?.postMessage({
      type: "resume",
      localTaskId,
    } satisfies UploadWorkerInput);
    setTasks((current) =>
      current.map((task) =>
        task.localTaskId === localTaskId ? { ...task, status: "running", updatedAt: new Date().toISOString() } : task,
      ),
    );
  }, []);

  const cancelTask = useCallback((localTaskId: string) => {
    workerRef.current?.postMessage({
      type: "cancel",
      localTaskId,
    } satisfies UploadWorkerInput);
    setTasks((current) =>
      current.map((task) =>
        task.localTaskId === localTaskId ? { ...task, status: "canceled", updatedAt: new Date().toISOString() } : task,
      ),
    );
  }, []);

  const clearTask = useCallback((localTaskId: string) => {
    setTasks((current) => current.filter((task) => task.localTaskId !== localTaskId));
  }, []);

  const value = useMemo<UploadTaskContextValue>(
    () => ({
      tasks,
      startUpload,
      pauseTask,
      resumeTask,
      cancelTask,
      clearTask,
    }),
    [cancelTask, clearTask, pauseTask, resumeTask, startUpload, tasks],
  );

  return (
    <UploadTaskContext.Provider value={value}>
      {children}
      <UploadFloatingDock
        onClose={() => setPanelOpen(false)}
        onOpen={() => setPanelOpen(true)}
        open={panelOpen}
        value={value}
      />
    </UploadTaskContext.Provider>
  );
}

export function useUploadTasks(): UploadTaskContextValue {
  const context = useContext(UploadTaskContext);

  if (!context) {
    throw new Error("useUploadTasks must be used within UploadTaskProvider");
  }

  return context;
}

function UploadFloatingDock({
  open,
  onOpen,
  onClose,
  value,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  value: UploadTaskContextValue;
}) {
  const activeTasks = value.tasks.filter((task) => ["running", "paused"].includes(task.status));
  const visibleTasks = value.tasks.slice(0, 6);

  if (value.tasks.length === 0) {
    return null;
  }

  const totalPercent =
    value.tasks.reduce((sum, task) => sum + task.progress.percent, 0) / Math.max(value.tasks.length, 1);

  return (
    <aside className="fixed bottom-4 right-4 z-40" aria-label="上传任务">
      <Button
        aria-controls="upload-task-panel"
        aria-expanded={open}
        className="rounded-full"
        onClick={open ? onClose : onOpen}
        type="button"
      >
        <span>上传</span>
        <strong>{Math.round(totalPercent)}%</strong>
        {activeTasks.length > 0 ? (
          <span className="inline-flex min-h-5 items-center rounded-full bg-primary/10 px-1.5 text-[11px] font-bold text-primary">
            {activeTasks.length}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          className="fixed bottom-4 right-4 z-40 w-[min(420px,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 shadow-surface"
          id="upload-task-panel"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <strong>上传任务</strong>
              <span>{value.tasks.length} 个任务</span>
            </div>
            <Button variant="outline" onClick={onClose} type="button">
              收起
            </Button>
          </div>
          {visibleTasks.map((task) => (
            <article className="grid gap-2 border-t border-border py-3 first:border-0" key={task.localTaskId}>
              <div className="font-semibold">
                <strong>{task.sourceName}</strong>
                <StatusBadge kind="upload-task" value={task.status} />
              </div>
              <span className="text-xs text-muted">{phaseLabel(task.phase)}</span>
              <Progress aria-label={`${task.sourceName} 上传进度`} value={Math.min(100, task.progress.percent)} />
              <StatList
                columns={2}
                items={[
                  {
                    label: "文件",
                    value: `${task.progress.processedFiles.toLocaleString("zh-CN")} / ${task.progress.totalFiles.toLocaleString("zh-CN")}`,
                  },
                  {
                    label: "上传对象",
                    value: `${task.progress.uploadedObjects.toLocaleString("zh-CN")} / ${task.progress.totalUploadObjects.toLocaleString("zh-CN")}`,
                  },
                  {
                    label: "文件大小",
                    value: formatBytes(task.stats.includedSizeBytes),
                  },
                ]}
                variant="tiles"
              />
              {task.error ? (
                <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 text-sm">{task.error}</p>
              ) : null}
              {task.progress.currentPath ? (
                <p className="font-mono text-sm text-muted">{task.progress.currentPath}</p>
              ) : null}
              {task.result ? (
                <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-800 text-sm">
                  游戏已入库，归档快照 #{task.result.archiveVersionId} 已处理。{" "}
                  <a className="font-bold underline" href={`/games/${task.result.workId}#relations`}>补充关联</a>
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                {task.status === "running" ? (
                  <Button variant="outline" onClick={() => value.pauseTask(task.localTaskId)} type="button">
                    暂停
                  </Button>
                ) : null}
                {task.status === "paused" ? (
                  <Button onClick={() => value.resumeTask(task.localTaskId)} type="button">
                    继续
                  </Button>
                ) : null}
                {["running", "paused"].includes(task.status) ? (
                  <Button variant="outline" onClick={() => value.cancelTask(task.localTaskId)} type="button">
                    取消
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => value.clearTask(task.localTaskId)} type="button">
                    清除
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function upsertTask(
  tasks: BrowserUploadTaskSnapshot[],
  nextTask: BrowserUploadTaskSnapshot,
): BrowserUploadTaskSnapshot[] {
  const index = tasks.findIndex((task) => task.localTaskId === nextTask.localTaskId);

  if (index < 0) {
    return [nextTask, ...tasks];
  }

  const next = tasks.slice();
  next[index] = nextTask;

  return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function phaseLabel(phase: BrowserUploadTaskSnapshot["phase"]): string {
  switch (phase) {
    case "enumerating":
      return "读取文件";
    case "hashing":
      return "校验文件";
    case "building_core_pack":
      return "整理文件";
    case "manifest_ready":
      return "检查完成";
    case "creating_import_job":
      return "创建任务";
    case "preflighting":
      return "上传前检查";
    case "uploading_missing_objects":
      return "上传文件";
    case "verifying_objects":
      return "校验上传";
    case "committing":
      return "提交入库";
    case "completed":
      return "完成";
    default:
      return "准备";
  }
}
