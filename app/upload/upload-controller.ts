import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { rememberPublishedTranslators } from "@/app/upload/translation-preference";
import type { DraftLock } from "@/app/upload/upload-drafts";
import {
  acquireDraftLock,
  deleteUploadDraft,
  listUploadDrafts,
  putUploadDraft,
  sourceObjectReferences,
} from "@/app/upload/upload-drafts";
import type {
  BrowserUploadTaskSnapshot,
  MetadataBlobUpload,
  UploadRecoveryDraft,
  UploadSourceFile,
  UploadSourceKind,
  UploadTaskCommitResult,
  UploadWorkerInput,
  UploadWorkerOutput,
} from "@/app/upload/upload-types";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import { useEffect, useRef, useState } from "react";

type PendingCancel = {
  promise: Promise<boolean>;
  resolve: (canceled: boolean) => void;
};

type DraftServerState =
  | { kind: "recoverable" }
  | { kind: "committing" }
  | { kind: "invalid" }
  | { kind: "unknown" };

type ResumeDraftResult =
  | { kind: "ready"; draft: UploadRecoveryDraft }
  | { kind: "committing"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "unknown"; message: string };

export function useUploadController(accountId: number) {
  const [task, setTask] = useState<BrowserUploadTaskSnapshot | null>(null);
  const [drafts, setDrafts] = useState<UploadRecoveryDraft[]>([]);
  const [committingDraftIds, setCommittingDraftIds] = useState<number[]>([]);
  const [controllerError, setControllerError] = useState<string | null>(null);
  const [metadataConfirmed, setMetadataConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const taskRef = useRef<BrowserUploadTaskSnapshot | null>(null);
  const pendingLocalTaskIdRef = useRef<string | null>(null);
  const draftLockRef = useRef<{ jobId: number; lock: DraftLock } | null>(null);
  const lockRequestRef = useRef<{
    jobId: number;
    promise: Promise<DraftLock | null>;
  } | null>(null);
  const pendingCancelRef = useRef<PendingCancel | null>(null);
  const disposedRef = useRef(false);

  function updateTask(nextTask: BrowserUploadTaskSnapshot | null) {
    taskRef.current = nextTask;
    setTask(nextTask);
  }

  function createTaskWorker(): Worker {
    if (workerRef.current) throw new Error("当前标签页已有上传任务");
    const worker = new Worker(new URL("./upload-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<UploadWorkerOutput>) => {
      const message = event.data;
      if (workerRef.current !== worker) return;

      if (message.type === "task") {
        setStarting(false);
        pendingLocalTaskIdRef.current = message.task.localTaskId;
        updateTask(message.task);
        if (message.task.status === "completed" && message.task.result) {
          rememberPublishedTranslators(
            accountId,
            message.task.result.translators,
          );
        }
        if (
          message.task.serverImportJobId &&
          !isTerminalTaskStatus(message.task.status)
        ) {
          beginTaskLock(worker, message.task);
        }
        return;
      }

      if (message.type === "draft_saved") {
        setDrafts((current) => upsertDraft(current, message.draft));
        return;
      }

      if (message.type === "cancel_rejected") {
        updateTask(message.task);
        setControllerError(message.message);
        resolvePendingCancel(false);
        return;
      }

      void finalizeWorker(worker, message);
    };
    workerRef.current = worker;
    return worker;
  }

  function beginTaskLock(worker: Worker, nextTask: BrowserUploadTaskSnapshot) {
    const jobId = nextTask.serverImportJobId;
    if (
      !jobId ||
      draftLockRef.current?.jobId === jobId ||
      lockRequestRef.current?.jobId === jobId
    ) {
      return;
    }
    const promise = acquireDraftLock(accountId, jobId);
    lockRequestRef.current = { jobId, promise };
    void promise
      .then(async (draftLock) => {
        if (lockRequestRef.current?.promise === promise)
          lockRequestRef.current = null;
        if (
          draftLock &&
          workerRef.current === worker &&
          taskRef.current?.serverImportJobId === jobId
        ) {
          draftLockRef.current = { jobId, lock: draftLock };
          return;
        }
        await draftLock?.release();
        if (workerRef.current !== worker) return;
        setControllerError("这个上传任务正在另一个标签页中处理。");
        void cancelTask(false);
      })
      .catch((error: unknown) => {
        if (lockRequestRef.current?.promise === promise)
          lockRequestRef.current = null;
        if (workerRef.current !== worker) return;
        setControllerError(draftLockErrorMessage(error));
        void cancelTask(false);
      });
  }

  async function finalizeWorker(
    worker: Worker,
    message: Extract<UploadWorkerOutput, { type: "settled" }>,
  ) {
    if (workerRef.current !== worker) return;
    workerRef.current = null;
    worker.terminate();
    setStarting(false);
    updateTask(message.task);
    if (message.task.status === "completed" && message.task.result) {
      rememberPublishedTranslators(accountId, message.task.result.translators);
    }
    const jobId = message.task.serverImportJobId;
    if (jobId) {
      setDrafts((current) =>
        current.filter((draft) => draft.serverImportJobId !== jobId),
      );
      setCommittingDraftIds((current) => current.filter((id) => id !== jobId));
    }
    try {
      await releaseCurrentDraftLock(jobId);
    } catch {
      setControllerError(
        "任务已结束，但上传草稿锁释放失败；关闭此标签页后浏览器会自动释放。",
      );
    } finally {
      resolvePendingCancel(true);
    }
    if (jobId && !message.draftRemoved) {
      setControllerError(
        "任务已结束，但本地恢复草稿未能清除；重新打开页面后会再次清理。",
      );
    }
  }

  async function releaseCurrentDraftLock(jobId: number | null = null) {
    const current = draftLockRef.current;
    if (!current || (jobId !== null && current.jobId !== jobId)) return;
    draftLockRef.current = null;
    await current.lock.release();
  }

  function resolvePendingCancel(canceled: boolean) {
    const pending = pendingCancelRef.current;
    pendingCancelRef.current = null;
    if (!disposedRef.current) setCanceling(false);
    pending?.resolve(canceled);
  }

  useEffect(() => {
    let stopped = false;
    void listUploadDrafts(accountId)
      .then(async (stored) => {
        const visible: UploadRecoveryDraft[] = [];
        const committing: number[] = [];
        for (const draft of stored) {
          const state = await inspectDraftServerState(
            draft.serverImportJobId,
            draft.accountId,
          );
          if (state.kind === "invalid") {
            await deleteUploadDraft(
              draft.accountId,
              draft.serverImportJobId,
            ).catch(() => undefined);
            continue;
          }
          visible.push(draft);
          if (state.kind === "committing")
            committing.push(draft.serverImportJobId);
        }
        if (!stopped) {
          setDrafts(visible);
          setCommittingDraftIds(committing);
        }
      })
      .catch(() => {
        if (!stopped) setControllerError("无法读取本地上传草稿。");
      });
    return () => {
      stopped = true;
    };
  }, [accountId]);

  const active = starting || workerRef.current !== null;
  useNavigationGuard(active, async () => {
    if (!window.confirm("离开此页将取消当前上传。是否继续？")) return false;
    return cancelTask();
  });

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      workerRef.current?.terminate();
      workerRef.current = null;
      resolvePendingCancel(false);
      void releaseCurrentDraftLock();
    };
  }, []);

  function startSource(input: {
    sourceKind: UploadSourceKind;
    sourceName: string;
    files: UploadSourceFile[];
    targetWorkId: number | null;
  }) {
    if (active || workerRef.current) return;
    setControllerError(null);
    const localTaskId = crypto.randomUUID();
    pendingLocalTaskIdRef.current = localTaskId;
    setStarting(true);
    createTaskWorker().postMessage({
      type: "start_source",
      accountId,
      localTaskId,
      ...input,
    } satisfies UploadWorkerInput);
  }

  function confirmMetadata(
    metadata: ArchiveCommitMetadata,
    metadataBlobs: MetadataBlobUpload[],
  ) {
    if (taskRef.current?.commitStarted) return;
    const localTaskId =
      taskRef.current?.localTaskId ?? pendingLocalTaskIdRef.current;
    if (!localTaskId || !workerRef.current) return;
    // Keep the user's choice stable while earlier progress messages arrive.
    setMetadataConfirmed(true);
    workerRef.current.postMessage({
      type: "confirm_metadata",
      localTaskId,
      metadata,
      metadataBlobs,
    } satisfies UploadWorkerInput);
  }

  function revokeMetadata() {
    if (taskRef.current?.commitStarted) return;
    setMetadataConfirmed(false);
    const localTaskId =
      taskRef.current?.localTaskId ?? pendingLocalTaskIdRef.current;
    if (!localTaskId || !workerRef.current) return;
    workerRef.current.postMessage({
      type: "revoke_metadata",
      localTaskId,
    } satisfies UploadWorkerInput);
  }

  async function restoreDraft(
    draft: UploadRecoveryDraft,
    options: { clearMetadata?: boolean } = {},
  ): Promise<boolean> {
    if (active || workerRef.current) return false;
    setControllerError(null);
    if (committingDraftIds.includes(draft.serverImportJobId)) {
      setControllerError("这个上传任务正在提交，暂时不能继续编辑。");
      return false;
    }

    let draftLock: DraftLock | null;
    try {
      draftLock = await acquireDraftLock(accountId, draft.serverImportJobId);
    } catch (error) {
      setControllerError(draftLockErrorMessage(error));
      return false;
    }
    if (!draftLock) {
      setControllerError("这个上传草稿正在另一个标签页中处理。");
      return false;
    }

    const result = await resumeDraftOnServer(draft);
    if (result.kind !== "ready") {
      if (result.kind === "invalid") {
        await deleteUploadDraft(accountId, draft.serverImportJobId).catch(
          () => undefined,
        );
        setDrafts((current) =>
          current.filter((item) => item.key !== draft.key),
        );
        setCommittingDraftIds((current) =>
          current.filter((id) => id !== draft.serverImportJobId),
        );
      } else if (result.kind === "committing") {
        setCommittingDraftIds((current) =>
          uniqueNumbers([...current, draft.serverImportJobId]),
        );
      }
      await draftLock.release();
      setControllerError(result.message);
      return false;
    }

    const restoredDraft = options.clearMetadata
      ? {
          ...result.draft,
          metadata: null,
          metadataBlobs: [],
          metadataConfirmed: false,
        }
      : result.draft;
    try {
      await putUploadDraft(restoredDraft);
    } catch {
      await draftLock.release();
      setControllerError("无法更新本地上传草稿，请刷新页面后重试。");
      return false;
    }
    if (disposedRef.current) {
      await draftLock.release();
      return false;
    }

    setDrafts((current) => upsertDraft(current, restoredDraft));
    setCommittingDraftIds((current) =>
      current.filter((id) => id !== draft.serverImportJobId),
    );
    draftLockRef.current = { jobId: draft.serverImportJobId, lock: draftLock };
    pendingLocalTaskIdRef.current = restoredDraft.localTaskId;
    setMetadataConfirmed(restoredDraft.metadataConfirmed);
    createTaskWorker().postMessage({
      type: "restore",
      draft: restoredDraft,
    } satisfies UploadWorkerInput);
    return true;
  }

  async function discardDraft(draft: UploadRecoveryDraft): Promise<void> {
    setControllerError(null);
    if (committingDraftIds.includes(draft.serverImportJobId)) {
      setControllerError("这个上传任务正在提交，当前不能放弃。");
      return;
    }
    let draftLock: DraftLock | null;
    try {
      draftLock = await acquireDraftLock(accountId, draft.serverImportJobId);
    } catch (error) {
      setControllerError(draftLockErrorMessage(error));
      return;
    }
    if (!draftLock) {
      setControllerError("这个上传草稿正在另一个标签页中处理。");
      return;
    }
    try {
      if (!(await cancelOwnedImportJob(draft.serverImportJobId))) {
        setControllerError("服务端尚未确认取消，上传草稿已保留，请稍后重试。");
        return;
      }
      await deleteUploadDraft(accountId, draft.serverImportJobId);
      setDrafts((current) => current.filter((item) => item.key !== draft.key));
      setCommittingDraftIds((current) =>
        current.filter((id) => id !== draft.serverImportJobId),
      );
    } finally {
      await draftLock.release();
    }
  }

  function cancelTask(clearError = true): Promise<boolean> {
    if (clearError) setControllerError(null);
    const currentTask = taskRef.current;
    if (currentTask?.phase === "committing") {
      setControllerError("任务正在提交，当前不能取消或离开上传页。");
      return Promise.resolve(false);
    }
    if (!workerRef.current) return Promise.resolve(true);
    if (pendingCancelRef.current) return pendingCancelRef.current.promise;
    const localTaskId =
      currentTask?.localTaskId ?? pendingLocalTaskIdRef.current;
    if (!localTaskId) return Promise.resolve(false);

    let resolve!: (canceled: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    pendingCancelRef.current = { promise, resolve };
    setCanceling(true);
    workerRef.current.postMessage({
      type: "cancel",
      localTaskId,
    } satisfies UploadWorkerInput);
    return promise;
  }

  return {
    task,
    drafts,
    committingDraftIds,
    active,
    canceling,
    controllerError,
    metadataConfirmed: metadataConfirmed || Boolean(task?.commitStarted),
    startSource,
    confirmMetadata,
    revokeMetadata,
    restoreDraft,
    discardDraft,
    cancelTask,
    resetTask: () => {
      if (workerRef.current) return;
      updateTask(null);
      setStarting(false);
      setCanceling(false);
      pendingLocalTaskIdRef.current = null;
      setMetadataConfirmed(false);
      setControllerError(null);
    },
  };
}

async function inspectDraftServerState(
  importJobId: number,
  accountId?: number,
): Promise<DraftServerState> {
  const response = await fetch(`/api/imports/${importJobId}`, {
    credentials: "same-origin",
  }).catch(() => null);
  if (!response) return { kind: "unknown" };
  if ([400, 403, 404].includes(response.status)) return { kind: "invalid" };
  if (!response.ok) return { kind: "unknown" };
  const payload = (await response.json().catch(() => null)) as {
    ok: true;
    importJob: { status: string; result: UploadTaskCommitResult | null };
  } | null;
  const status = payload?.ok ? payload.importJob.status : null;
  if (
    status === "completed" &&
    payload?.importJob.result &&
    accountId !== undefined
  ) {
    rememberPublishedTranslators(
      accountId,
      payload.importJob.result.translators,
    );
  }
  if (status === "awaiting_metadata" || status === "uploading_metadata") {
    return { kind: "recoverable" };
  }
  if (status === "committing") return { kind: "committing" };
  return status ? { kind: "invalid" } : { kind: "unknown" };
}

async function resumeDraftOnServer(
  draft: UploadRecoveryDraft,
): Promise<ResumeDraftResult> {
  const response = await fetch(
    `/api/imports/${draft.serverImportJobId}/resume`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sourceObjectReferences(draft.preparedSource)),
    },
  ).catch(() => null);
  if (!response) {
    return {
      kind: "unknown",
      message: "无法连接服务器，上传草稿已保留，请稍后重试。",
    };
  }
  const payload = (await response.json().catch(() => null)) as
    | {
        ok: true;
        importJob: { status: string; updatedAt: string };
      }
    | { ok: false; detail?: string; error?: string }
    | null;
  if (response.ok && payload?.ok) {
    return {
      kind: "ready",
      draft: {
        ...draft,
        updatedAt: payload.importJob.updatedAt,
      },
    };
  }

  const message = responseErrorMessage(
    payload && !payload.ok ? payload : null,
    "上传草稿无法继续，请重新上传。",
  );
  if ([400, 403, 404].includes(response.status))
    return { kind: "invalid", message };
  if (response.status !== 409) return { kind: "unknown", message };
  const state = await inspectDraftServerState(
    draft.serverImportJobId,
    draft.accountId,
  );
  if (state.kind === "committing") {
    return {
      kind: "committing",
      message: "这个上传任务正在提交，暂时不能继续编辑。",
    };
  }
  if (state.kind === "unknown") return { kind: "unknown", message };
  return { kind: "invalid", message };
}

async function cancelOwnedImportJob(importJobId: number): Promise<boolean> {
  const response = await fetch(`/api/imports/${importJobId}/cancel`, {
    method: "POST",
    credentials: "same-origin",
  }).catch(() => null);
  if (response?.ok) return true;
  const state = await inspectDraftServerState(importJobId);
  return state.kind === "invalid";
}

function isTerminalTaskStatus(
  status: BrowserUploadTaskSnapshot["status"],
): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function responseErrorMessage(
  payload: { detail?: string; error?: string } | null,
  fallback: string,
): string {
  return payload?.detail || payload?.error || fallback;
}

function draftLockErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "无法锁定上传草稿，请刷新页面后重试。";
}

function upsertDraft(
  drafts: UploadRecoveryDraft[],
  draft: UploadRecoveryDraft,
): UploadRecoveryDraft[] {
  return [draft, ...drafts.filter((item) => item.key !== draft.key)].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}
