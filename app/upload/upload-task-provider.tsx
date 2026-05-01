"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import {
  clearTaskSnapshot,
  loadTaskSnapshots,
} from "@/app/upload/upload-task-db";
import type {
  BrowserUploadTaskSnapshot,
  UploadSourceKind,
  UploadWorkerInput,
  UploadWorkerOutput,
} from "@/app/upload/upload-types";

type StartUploadInput = {
  sourceKind: UploadSourceKind;
  files: File[];
  metadata: ArchiveCommitMetadata;
  resumeLocalTaskId?: string | null;
};

type UploadTaskContextValue = {
  tasks: BrowserUploadTaskSnapshot[];
  activeTask: BrowserUploadTaskSnapshot | null;
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
    let mounted = true;

    loadTaskSnapshots()
      .then((items) => {
        if (!mounted) {
          return;
        }

        setTasks(
          items.map((task) =>
            isUnfinished(task)
              ? {
                  ...task,
                  status: "needs_source_reselect",
                  updatedAt: new Date().toISOString(),
                }
              : task,
          ),
        );
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const hasActiveTask = tasks.some((task) =>
      ["running", "paused", "needs_source_reselect"].includes(task.status),
    );

    if (!hasActiveTask) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const checkpoint = () => {
      workerRef.current?.postMessage({ type: "checkpoint" } satisfies UploadWorkerInput);
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", checkpoint);
    document.addEventListener("visibilitychange", checkpoint);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", checkpoint);
      document.removeEventListener("visibilitychange", checkpoint);
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
      const localTaskId = input.resumeLocalTaskId ?? crypto.randomUUID();

      worker.postMessage({
        type: "start",
        localTaskId,
        resumeLocalTaskId: input.resumeLocalTaskId ?? null,
        sourceKind: input.sourceKind,
        files: input.files,
        metadata: input.metadata,
      } satisfies UploadWorkerInput);
      setPanelOpen(true);
    },
    [ensureWorker],
  );

  const pauseTask = useCallback(
    (localTaskId: string) => {
      workerRef.current?.postMessage({
        type: "pause",
        localTaskId,
      } satisfies UploadWorkerInput);
      setTasks((current) =>
        current.map((task) =>
          task.localTaskId === localTaskId
            ? { ...task, status: "paused", updatedAt: new Date().toISOString() }
            : task,
        ),
      );
    },
    [],
  );

  const resumeTask = useCallback((localTaskId: string) => {
    workerRef.current?.postMessage({
      type: "resume",
      localTaskId,
    } satisfies UploadWorkerInput);
    setTasks((current) =>
      current.map((task) =>
        task.localTaskId === localTaskId
          ? { ...task, status: "running", updatedAt: new Date().toISOString() }
          : task,
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
        task.localTaskId === localTaskId
          ? { ...task, status: "canceled", updatedAt: new Date().toISOString() }
          : task,
      ),
    );
  }, []);

  const clearTask = useCallback((localTaskId: string) => {
    clearTaskSnapshot(localTaskId).catch(() => undefined);
    setTasks((current) => current.filter((task) => task.localTaskId !== localTaskId));
  }, []);

  const activeTask = tasks.find((task) => task.status === "running") ?? tasks[0] ?? null;
  const value = useMemo<UploadTaskContextValue>(
    () => ({
      tasks,
      activeTask,
      startUpload,
      pauseTask,
      resumeTask,
      cancelTask,
      clearTask,
    }),
    [activeTask, cancelTask, clearTask, pauseTask, resumeTask, startUpload, tasks],
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
  const activeTasks = value.tasks.filter((task) =>
    ["running", "paused", "needs_source_reselect"].includes(task.status),
  );
  const visibleTasks = value.tasks.slice(0, 6);

  if (value.tasks.length === 0) {
    return null;
  }

  const totalPercent =
    value.tasks.reduce((sum, task) => sum + task.progress.percent, 0) /
    Math.max(value.tasks.length, 1);

  return (
    <aside className="upload-dock" aria-label="上传任务">
      <button className="upload-dock-button" onClick={open ? onClose : onOpen} type="button">
        <span>上传</span>
        <strong>{Math.round(totalPercent)}%</strong>
        {activeTasks.length > 0 ? (
          <span className="notification-badge">{activeTasks.length}</span>
        ) : null}
      </button>
      {open ? (
        <div className="upload-panel">
          <div className="upload-panel-header">
            <strong>上传任务</strong>
            <button className="button" onClick={onClose} type="button">
              收起
            </button>
          </div>
          {visibleTasks.map((task) => (
            <article className="upload-task-item" key={task.localTaskId}>
              <div className="upload-task-title">
                <strong>{task.sourceName}</strong>
                <span>{statusLabel(task.status)} / {phaseLabel(task.phase)}</span>
              </div>
              <div className="upload-progress">
                <span style={{ width: `${Math.min(100, task.progress.percent)}%` }} />
              </div>
              <dl className="upload-task-metrics">
                <div>
                  <dt>文件</dt>
                  <dd>
                    {task.progress.processedFiles.toLocaleString("zh-CN")} /{" "}
                    {task.progress.totalFiles.toLocaleString("zh-CN")}
                  </dd>
                </div>
                <div>
                  <dt>对象</dt>
                  <dd>
                    {task.progress.uploadedObjects.toLocaleString("zh-CN")} /{" "}
                    {task.progress.totalUploadObjects.toLocaleString("zh-CN")}
                  </dd>
                </div>
                <div>
                  <dt>归档</dt>
                  <dd>{formatBytes(task.stats.includedSizeBytes)}</dd>
                </div>
              </dl>
              {task.error ? <p className="error-message compact">{task.error}</p> : null}
              {task.progress.currentPath ? (
                <p className="upload-current-path">{task.progress.currentPath}</p>
              ) : null}
              {task.result ? (
                <p className="success-message compact">
                  ArchiveVersion #{task.result.archiveVersionId} 已提交
                </p>
              ) : null}
              <div className="actions compact-actions">
                {task.status === "running" ? (
                  <button
                    className="button"
                    onClick={() => value.pauseTask(task.localTaskId)}
                    type="button"
                  >
                    暂停
                  </button>
                ) : null}
                {task.status === "paused" ? (
                  <button
                    className="button primary"
                    onClick={() => value.resumeTask(task.localTaskId)}
                    type="button"
                  >
                    继续
                  </button>
                ) : null}
                {["running", "paused", "needs_source_reselect"].includes(task.status) ? (
                  <button
                    className="button"
                    onClick={() => value.cancelTask(task.localTaskId)}
                    type="button"
                  >
                    取消
                  </button>
                ) : (
                  <button
                    className="button"
                    onClick={() => value.clearTask(task.localTaskId)}
                    type="button"
                  >
                    清除
                  </button>
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

function isUnfinished(task: BrowserUploadTaskSnapshot): boolean {
  return !["completed", "failed_terminal", "canceled"].includes(task.status);
}

function statusLabel(status: BrowserUploadTaskSnapshot["status"]): string {
  switch (status) {
    case "running":
      return "处理中";
    case "paused":
      return "已暂停";
    case "needs_source_reselect":
      return "需要重选源";
    case "completed":
      return "完成";
    case "failed_recoverable":
      return "可重试失败";
    case "failed_terminal":
      return "终止失败";
    case "canceled":
      return "已取消";
    default:
      return "已创建";
  }
}

function phaseLabel(phase: BrowserUploadTaskSnapshot["phase"]): string {
  switch (phase) {
    case "enumerating":
      return "枚举";
    case "hashing":
      return "哈希";
    case "building_core_pack":
      return "打包";
    case "manifest_ready":
      return "清单";
    case "creating_import_job":
      return "创建任务";
    case "preflighting":
      return "预检";
    case "uploading_missing_objects":
      return "上传";
    case "verifying_objects":
      return "复核";
    case "committing":
      return "提交";
    case "completed":
      return "完成";
    default:
      return "准备";
  }
}

function formatBytes(value: number): string {
  let next = value;

  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (next < 1024 || unit === "GB") {
      return unit === "B" ? `${next} B` : `${next.toFixed(2)} ${unit}`;
    }

    next /= 1024;
  }

  return `${value} B`;
}
