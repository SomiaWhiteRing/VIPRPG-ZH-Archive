import { translate } from "@/lib/i18n/core";
import { formatFeedbackError, UiFeedbackError } from "@/lib/i18n/feedback";
import type { UiLocale } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { apiResponseError, requestResponse, readJsonResponse } from "@/lib/ui/api-response";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { rememberPublishedTranslators } from "@/app/upload/translation-preference";
import { type DraftLock, acquireDraftLock, deleteUploadDraft, listUploadDrafts, putUploadDraft, sourceObjectReferences } from "@/app/upload/upload-drafts";

import type {
  BrowserUploadTaskSnapshot,
  MetadataBlobUpload,
  UploadFormDraft,
  UploadExtraCandidate,
  UploadRecoveryDraft,
  UploadSourceFile,
  UploadSourceKind,
  UploadSourcePrefill,
  UploadTaskCommitResult,
  UploadWorkerInput,
  UploadWorkerOutput,
} from "@/app/upload/upload-types";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const t = useMessages();
  const locale = useUiLocale();
  const [extraCandidates, setExtraCandidates] = useState<UploadExtraCandidate[]>([]);
  const [extraSourceAvailable, setExtraSourceAvailable] = useState(false);
  const [task, setTask] = useState<BrowserUploadTaskSnapshot | null>(null);
  const [drafts, setDrafts] = useState<UploadRecoveryDraft[]>([]);
  const [committingDraftIds, setCommittingDraftIds] = useState<number[]>([]);
  const [controllerError, setControllerError] = useState<string | UiFeedbackError | null>(null);
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
    if (nextTask?.status === "failed" || nextTask?.status === "canceled") {
      setMetadataConfirmed(false);
    }
    taskRef.current = nextTask;
    setTask(nextTask);
  }

  function createTaskWorker(
    onPrefill?: (prefill: UploadSourcePrefill) => void,
  ): Worker {
    if (workerRef.current) throw new UiFeedbackError("upload.draft.tabBusy");
    setExtraCandidates([]);
    setExtraSourceAvailable(false);
    const worker = new Worker(new URL("./upload-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<UploadWorkerOutput>) => {
      const message = event.data;
      if (workerRef.current !== worker) return;

      if (message.type === "extra_candidates") {
        setExtraCandidates(message.candidates);
        setExtraSourceAvailable(message.available);
        return;
      }

      if (message.type === "source_prefill") {
        onPrefill?.(message.prefill);
        return;
      }

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

      if (message.type === "draft_save_error") {
        setControllerError(message.messageKey ? new UiFeedbackError(message.messageKey) : message.message);
        return;
      }

      if (message.type === "cancel_rejected") {
        updateTask(message.task);
        const detail = message.task.errorMessage;
        setControllerError(detail ? new UiFeedbackError(detail.key, detail.values) : message.message);
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
        setControllerError(new UiFeedbackError("upload.draft.taskElsewhere"));
        void cancelTask(false);
      })
      .catch((error: unknown) => {
        if (lockRequestRef.current?.promise === promise)
          lockRequestRef.current = null;
        if (workerRef.current !== worker) return;
        setControllerError(formatFeedbackError(error, locale, t("upload.draft.lockFailed")));
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
      setControllerError(new UiFeedbackError("upload.draft.releaseFailed"));
    } finally {
      resolvePendingCancel(true);
    }
    if (jobId && !message.draftRemoved) {
      setControllerError(new UiFeedbackError("upload.draft.cleanupFailed"));
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
        if (!stopped) setControllerError(new UiFeedbackError("upload.draft.readFailed"));
      });
    return () => {
      stopped = true;
    };
  }, [accountId]);

  const confirm = useConfirm();
  const active = starting || workerRef.current !== null;
  useNavigationGuard(active, async () => {
    if (!(await confirm(t("upload.draft.leaveDescription"), { title: t("upload.draft.leaveTitle"), confirmLabel: t("upload.draft.leaveConfirm") }))) return false;
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

  function startSource(
    input: {
      sourceKind: UploadSourceKind;
      checkMissingResources: boolean;
      useSharedPlayer: boolean;
      sourceName: string;
      files: UploadSourceFile[];
      targetWorkId: number | null;
    },
    onPrefill?: (prefill: UploadSourcePrefill) => void,
  ) {
    if (active || workerRef.current) return;
    setControllerError(null);
    const localTaskId = crypto.randomUUID();
    pendingLocalTaskIdRef.current = localTaskId;
    setStarting(true);
    createTaskWorker(onPrefill).postMessage({
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
    if (taskRef.current?.commitStarted || taskRef.current?.extrasBusy || taskRef.current?.extrasError) return;
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

  async function restoreDraft(draft: UploadRecoveryDraft): Promise<boolean> {
    if (active || workerRef.current) return false;
    setControllerError(null);
    if (committingDraftIds.includes(draft.serverImportJobId)) {
      setControllerError(new UiFeedbackError("upload.draft.committing"));
      return false;
    }

    let draftLock: DraftLock | null;
    try {
      draftLock = await acquireDraftLock(accountId, draft.serverImportJobId);
    } catch (error) {
      setControllerError(formatFeedbackError(error, locale, t("upload.draft.lockFailed")));
      return false;
    }
    if (!draftLock) {
      setControllerError(new UiFeedbackError("upload.draft.draftElsewhere"));
      return false;
    }

    const result = await resumeDraftOnServer(draft, locale);
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

    const restoredDraft = { ...result.draft, metadataConfirmed: false };
    try {
      await putUploadDraft(restoredDraft);
    } catch {
      await draftLock.release();
      setControllerError(new UiFeedbackError("upload.draft.updateFailed"));
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
      setControllerError(new UiFeedbackError("upload.draft.discardLocked"));
      return;
    }
    let draftLock: DraftLock | null;
    try {
      draftLock = await acquireDraftLock(accountId, draft.serverImportJobId);
    } catch (error) {
      setControllerError(formatFeedbackError(error, locale, t("upload.draft.lockFailed")));
      return;
    }
    if (!draftLock) {
      setControllerError(new UiFeedbackError("upload.draft.draftElsewhere"));
      return;
    }
    try {
      if (!(await cancelOwnedImportJob(draft.serverImportJobId))) {
        setControllerError(new UiFeedbackError("upload.draft.cancelNotConfirmed"));
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
    if (!workerRef.current) return Promise.resolve(true);
    if (currentTask?.phase === "committing") {
      setControllerError(new UiFeedbackError("upload.draft.cancelLocked"));
      return Promise.resolve(false);
    }
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

  const saveFormDraft = useCallback((formDraft: UploadFormDraft) => {
    const task = taskRef.current;
    const localTaskId = task?.localTaskId ?? pendingLocalTaskIdRef.current;
    if (!localTaskId || !workerRef.current || task?.commitStarted) return;
    workerRef.current.postMessage({
      type: "save_form_draft",
      localTaskId,
      formDraft,
    } satisfies UploadWorkerInput);
  }, []);

  return {
    task,
    extraCandidates,
    extraSourceAvailable,
    selectExtras: (paths: string[]) => {
      if (taskRef.current) workerRef.current?.postMessage({ type: "select_extras", localTaskId: taskRef.current.localTaskId, paths } satisfies UploadWorkerInput);
    },
    reloadExtraSource: (files: UploadSourceFile[], sourceKind: UploadSourceKind) => {
      if (taskRef.current) workerRef.current?.postMessage({ type: "extras_source", localTaskId: taskRef.current.localTaskId, files, sourceKind } satisfies UploadWorkerInput);
    },
    drafts,
    committingDraftIds,
    active,
    canceling,
    controllerError: controllerError instanceof UiFeedbackError
      ? t(controllerError.messageKey, controllerError.values)
      : controllerError,
    metadataConfirmed: metadataConfirmed || Boolean(task?.commitStarted),
    startSource,
    confirmMetadata,
    revokeMetadata,
    saveFormDraft,
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
  const response = await requestResponse(`/api/imports/${importJobId}`, {
    credentials: "same-origin",
  }).catch(() => null);
  if (!response) return { kind: "unknown" };
  if ([400, 403, 404].includes(response.status)) return { kind: "invalid" };
  if (!response.ok) return { kind: "unknown" };
  const payload = (await readJsonResponse(response).catch(() => null)) as {
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
  locale: UiLocale,
): Promise<ResumeDraftResult> {
  const response = await requestResponse(
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
      message: translate(locale, "upload.draft.resumeOffline"),
    };
  }
  const payload = (await readJsonResponse(response, translate(locale, "upload.draft.resumeFailed"), true).catch(() => null)) as
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

  const message = apiResponseError(
    response.status,
    payload && !payload.ok ? payload : {},
    translate(locale, "upload.draft.resumeFailed"),
  ).messageFor(locale);
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
      message: translate(locale, "upload.draft.committing"),
    };
  }
  if (state.kind === "unknown") return { kind: "unknown", message };
  return { kind: "invalid", message };
}

async function cancelOwnedImportJob(importJobId: number): Promise<boolean> {
  const response = await requestResponse(`/api/imports/${importJobId}/cancel`, {
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
