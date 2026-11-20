import { formatFeedbackError, UiFeedbackError } from "@/lib/i18n/feedback";
import type { UiLocale } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { requestJson } from "@/lib/ui/api-response";
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
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { GC_ITEM_RETRY_DETAIL, type GcJobAction, type GcJobReport } from "@/lib/archive/gc-job";
import { gcDefaultGraceDays, gcManualSweepGraceDays } from "@/lib/archive/gc-policy";
import { useEffect, useRef, useState } from "react";

type Activity = "recovering" | "starting" | "scanning" | "confirming" | "running" | "retrying" | "cancelling" | "refreshing" | "discarding";
type CleanupRequest = { action: GcJobAction; jobId?: string; graceDays?: number; confirm?: "SWEEP" };

async function requestCleanup(request: CleanupRequest): Promise<GcJobReport | null> {
  const payload = await requestJson<{
    ok?: boolean; job?: GcJobReport | null;
  }>("/api/admin/gc/sweep", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, { messageKey: "admin.cleanup.cleanupFailed" });
  if (payload.job === undefined) throw new UiFeedbackError("admin.cleanup.missingResponse");
  if (request.jobId && payload.job?.id !== request.jobId) {
    throw new UiFeedbackError("admin.cleanup.mismatch");
  }
  return payload.job;
}

function requireJob(job: GcJobReport | null): GcJobReport {
  if (!job) throw new UiFeedbackError("admin.cleanup.missing");
  return job;
}

export function FinalCleanupPanel() {
  const t = useMessages();
  const locale = useUiLocale();
  const [job, setJob] = useState<GcJobReport | null>(null);
  const [graceDays, setGraceDays] = useState(String(gcManualSweepGraceDays));
  const [activity, setActivity] = useState<Activity | null>("recovering");
  const [error, setError] = useState<{ failure: unknown; fallback: "admin.cleanup.readFailed" | "admin.cleanup.cleanupFailed" } | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [stopRequested, setStopRequested] = useState<"pause" | "cancel" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const busyRef = useRef(true);
  const mountedRef = useRef(false);
  const pauseRef = useRef(false);
  const cancelRef = useRef(false);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const discardButtonRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  // Recover persisted work, but never resume a scan or deletion without a click.
  useEffect(() => {
    let current = true;
    mountedRef.current = true;
    void requestCleanup({ action: "status" })
      .then((latest) => {
        if (!current) return;
        setJob(latest);
        if (latest) setGraceDays(String(latest.graceDays));
      })
      .catch((failure: unknown) => {
        if (!current) return;
        setError({ failure, fallback: "admin.cleanup.readFailed" });
        setNeedsRefresh(true);
      })
      .finally(() => {
        if (!current) return;
        busyRef.current = false;
        setActivity(null);
      });
    return () => {
      current = false;
      mountedRef.current = false;
      // Do not abort an in-flight deletion: only prevent the next batch.
      pauseRef.current = true;
    };
  }, []);

  function receive(next: GcJobReport): GcJobReport {
    if (mountedRef.current) {
      setJob(next);
      setGraceDays(String(next.graceDays));
    }
    return next;
  }

  async function perform(nextActivity: Activity, task: () => Promise<void>): Promise<void> {
    // State alone cannot guard two clicks arriving before React renders again.
    if (busyRef.current || !mountedRef.current) return;
    busyRef.current = true;
    pauseRef.current = false;
    cancelRef.current = false;
    setActivity(nextActivity);
    setStopRequested(null);
    setError(null);
    try {
      await task();
    } catch (failure) {
      if (mountedRef.current) {
        setError({ failure, fallback: "admin.cleanup.cleanupFailed" });
        // The server may have committed a request whose response was lost.
        setNeedsRefresh(true);
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setActivity(null);
        setStopRequested(null);
      }
    }
  }

  async function advance(initial: GcJobReport, action: "scan" | "run"): Promise<void> {
    let current = receive(initial);
    const expectedStatus = action === "scan" ? "scanning" : "running";
    if (mountedRef.current) setActivity(action === "scan" ? "scanning" : "running");
    while (mountedRef.current && !pauseRef.current && current.status === expectedStatus) {
      current = receive(requireJob(await requestCleanup({ action, jobId: current.id })));
    }
    // Cancellation waits for the current scan page. No deletion can be cancelled.
    if (mountedRef.current && cancelRef.current && (current.status === "scanning" || current.status === "ready")) {
      setActivity("cancelling");
      receive(requireJob(await requestCleanup({ action: "cancel", jobId: current.id })));
    }
  }

  async function refresh(): Promise<void> {
    await perform("refreshing", async () => {
      const latest = await requestCleanup({ action: "status", ...(job ? { jobId: job.id } : {}) });
      if (!mountedRef.current) return;
      setJob(latest);
      if (latest) setGraceDays(String(latest.graceDays));
      setNeedsRefresh(false);
    });
  }

  async function start(): Promise<void> {
    if (job || !validGraceDays(graceDays) || needsRefresh) return;
    await perform("starting", async () => {
      const created = requireJob(await requestCleanup({ action: "start", graceDays: Number(graceDays) }));
      await advance(created, "scan");
    });
  }

  async function confirm(): Promise<void> {
    if (confirmation !== "SWEEP" || job?.status !== "ready" || needsRefresh) return;
    await perform("confirming", async () => {
      setConfirmOpen(false);
      setConfirmation("");
      const confirmed = requireJob(await requestCleanup({ action: "confirm", jobId: job.id, confirm: "SWEEP" }));
      await advance(confirmed, "run");
    });
  }

  async function retry(): Promise<void> {
    if (job?.status !== "needs_retry" || needsRefresh) return;
    await perform("retrying", async () => {
      const retried = requireJob(await requestCleanup({ action: "retry", jobId: job.id }));
      await advance(retried, "run");
    });
  }

  function requestStop(cancel: boolean): void {
    pauseRef.current = true;
    cancelRef.current = cancelRef.current || cancel;
    setStopRequested(cancelRef.current ? "cancel" : "pause");
  }

  async function cancelScan(): Promise<void> {
    if (job?.status !== "scanning" || needsRefresh) return;
    if (busyRef.current) {
      requestStop(true);
      return;
    }
    await perform("cancelling", async () => {
      receive(requireJob(await requestCleanup({ action: "cancel", jobId: job.id })));
    });
  }

  async function discard(): Promise<void> {
    if (!job || !["ready", "completed", "cancelled"].includes(job.status) || needsRefresh) return;
    await perform("discarding", async () => {
      setDiscardOpen(false);
      if (job.status === "ready") {
        receive(requireJob(await requestCleanup({ action: "cancel", jobId: job.id })));
      }
      if (mountedRef.current) setJob(null);
    });
  }

  const busy = activity !== null;
  const safetyBlocked = Boolean(job?.safetyLocks.staleExecution || job?.safetyLocks.staleManifestCount);
  const blocked = busy || needsRefresh || safetyBlocked;
  const canPause = ["scanning", "confirming", "running", "retrying"].includes(activity ?? "");
  const canDiscard = job && ["ready", "completed", "cancelled"].includes(job.status);
  const graceValid = validGraceDays(graceDays);
  const scanning = job?.status === "scanning";

  return (
    <section aria-labelledby="final-cleanup-heading" className="mt-4 space-y-4 border-t border-border pt-4">
      <h4 className="font-semibold" id="final-cleanup-heading">{t("admin.cleanup.title")}</h4>
      <p className="text-sm text-muted">
        {t("admin.cleanup.intro", { days: gcDefaultGraceDays })}
      </p>
      <div className="max-w-sm space-y-2">
        <Label htmlFor="gc-sweep-grace-days">{t("admin.cleanup.retention")}</Label>
        <Input
          aria-describedby="gc-sweep-grace-help"
          aria-invalid={!graceValid}
          disabled={busy || job !== null || needsRefresh}
          id="gc-sweep-grace-days"
          max="3650"
          min="0"
          onChange={(event) => setGraceDays(event.target.value)}
          step="1"
          type="number"
          value={graceDays}
        />
        <p className="text-sm text-muted" id="gc-sweep-grace-help">
          {graceValid ? t("admin.cleanup.valid") : t("admin.cleanup.invalid")}
        </p>
      </div>
      <p aria-live="polite" className="text-sm" ref={statusRef} role="status" tabIndex={-1}>
        {statusText(job, activity, stopRequested, t)}
      </p>
      {error ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm" role="alert">
          <p>{formatFeedbackError(error.failure, locale, t(error.fallback))}</p>
          <p>{t("admin.cleanup.stopped")}</p>
        </div>
      ) : null}
      {safetyBlocked ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm" role="alert">
          <p>{t("admin.cleanup.stale")}</p>
          <p>
            {[
              job?.safetyLocks.staleExecution ? t("admin.cleanup.executionLock") : "",
              job?.safetyLocks.staleManifestCount ? t("admin.cleanup.manifestLocks", { count: job.safetyLocks.staleManifestCount }) : "",
              t("admin.cleanup.inFlight"),
            ].filter(Boolean).join(locale === "en" ? " " : "")}
          </p>
          <p>{t("admin.cleanup.lockHelp")}</p>
        </div>
      ) : null}
      {job ? (
        <div className="space-y-3 rounded-md border border-border p-3 text-sm">
          <div>
            <p className="wrap-anywhere font-semibold">{t("admin.cleanup.job", { id: job.id })}</p>
            <p className="mt-0.5 text-xs text-muted">{t("admin.cleanup.jobDetails", { days: job.graceDays, date: formatExactTimestamp(job.createdAt) })}</p>
          </div>
          {scanning ? (
            <p>{t("admin.cleanup.scanProgress", { phase: t(`admin.cleanup.phase.${job.phase}`), count: job.totalItems })}</p>
          ) : job.status === "cancelled" ? (
            <p>{t("admin.cleanup.canceledPlan")}</p>
          ) : (
            <CleanupSummary job={job} />
          )}
          {job.confirmedAt ? (
            <div className="space-y-2">
              <Label htmlFor="gc-sweep-progress">{t("admin.cleanup.processed", { count: job.processedItems, total: job.totalItems })}</Label>
              <progress className="h-3 w-full" id="gc-sweep-progress" max={Math.max(1, job.totalItems)} value={Math.min(job.processedItems, Math.max(1, job.totalItems))} />
              <p>{t("admin.cleanup.purged", { archives: job.purgedArchiveCount, objects: job.deletedObjectCount, size: bytes(job.deletedSizeBytes, locale) })}</p>
              <p>{t("admin.cleanup.skipped", { skipped: job.skippedCount, failed: job.failedCount })}</p>
            </div>
          ) : null}
          {job.status === "needs_retry" ? (
            <p className="text-destructive">{t("admin.cleanup.retryNote")}</p>
          ) : null}
          {job.failures.length > 0 ? (
            <details>
              <summary className="cursor-pointer">{t("admin.cleanup.failureSummary", { count: job.failures.length, total: job.failedCount })}</summary>
              <ul className="mt-2 list-inside list-disc space-y-1 break-all">
                {job.failures.map((failure, index) => (
                  <li key={`${failure.type}:${failure.key}:${index}`}>
                    {t("admin.cleanup.failureDetail", {
                      type: failure.type,
                      key: failure.key,
                      detail: failure.error === GC_ITEM_RETRY_DETAIL ? t("admin.cleanup.itemRetry") : failure.error,
                    })}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {!job ? <Button disabled={blocked || !graceValid} onClick={() => void start()} type="button">{t("admin.cleanup.start")}</Button> : null}
        {scanning && !busy ? <Button disabled={blocked} onClick={() => void perform("scanning", () => advance(job, "scan"))} type="button">{t("admin.cleanup.resumeScan")}</Button> : null}
        {scanning ? <Button disabled={needsRefresh || stopRequested === "cancel" || (busy && activity !== "scanning")} onClick={() => void cancelScan()} type="button" variant="outline">{t("admin.cleanup.cancelScan")}</Button> : null}
        {job?.status === "ready" ? (
          <Button
            aria-controls="admin-sweep-confirm-dialog"
            aria-expanded={confirmOpen}
            aria-haspopup="dialog"
            disabled={blocked}
            onClick={() => { setConfirmation(""); setConfirmOpen(true); }}
            ref={reviewButtonRef}
            type="button"
            variant="destructive"
          >{t("admin.cleanup.review")}</Button>
        ) : null}
        {job?.status === "running" && !busy ? <Button disabled={blocked} onClick={() => void perform("running", () => advance(job, "run"))} type="button" variant="destructive">{t("admin.cleanup.resumeCleanup")}</Button> : null}
        {job?.status === "needs_retry" ? <Button disabled={blocked} onClick={() => void retry()} type="button" variant="destructive">{t("admin.cleanup.retry")}</Button> : null}
        {canPause ? <Button disabled={stopRequested !== null} onClick={() => requestStop(false)} type="button" variant="outline">{t("admin.cleanup.pause")}</Button> : null}
        {canDiscard ? (
          <Button
            aria-controls="admin-sweep-discard-dialog"
            aria-expanded={discardOpen}
            aria-haspopup="dialog"
            disabled={blocked}
            onClick={() => setDiscardOpen(true)}
            ref={discardButtonRef}
            type="button"
            variant="outline"
          >{t("admin.cleanup.discard")}</Button>
        ) : null}
        <Button disabled={busy} onClick={() => void refresh()} type="button" variant="outline">{t("admin.cleanup.refresh")}</Button>
      </div>
      <AlertDialog onOpenChange={(open) => { setConfirmOpen(open); if (!open) setConfirmation(""); }} open={confirmOpen}>
        <AlertDialogContent id="admin-sweep-confirm-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(reviewButtonRef.current, statusRef.current); }}>
          <AlertDialogTitle>{t("admin.cleanup.confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("admin.cleanup.confirmDescription", { days: job?.graceDays ?? 0 })}
          </AlertDialogDescription>
          {job?.status === "ready" ? <CleanupSummary job={job} /> : null}
          <div className="space-y-2">
            <Label htmlFor="gc-sweep-confirm">{t("admin.cleanup.phrase")}</Label>
            <Input autoCapitalize="off" autoCorrect="off" id="gc-sweep-confirm" onChange={(event) => setConfirmation(event.target.value)} spellCheck={false} value={confirmation} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button type="button" variant="outline">{t("admin.cleanup.back")}</Button></AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button disabled={blocked || confirmation !== "SWEEP" || job?.status !== "ready"} onClick={(event) => { event.preventDefault(); void confirm(); }} type="button" variant="destructive">{t("admin.cleanup.confirm")}</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog onOpenChange={setDiscardOpen} open={discardOpen}>
        <AlertDialogContent id="admin-sweep-discard-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(discardButtonRef.current, statusRef.current); }}>
          <AlertDialogTitle>{t("admin.cleanup.discardTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("admin.cleanup.discardDescription")}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button type="button" variant="outline">{t("admin.cleanup.keep")}</Button></AlertDialogCancel>
            <AlertDialogAction asChild><Button disabled={blocked} onClick={(event) => { event.preventDefault(); void discard(); }} type="button">{t("admin.cleanup.reset")}</Button></AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function CleanupSummary({ job }: { job: GcJobReport }) {
  const t = useMessages();
  const locale = useUiLocale();
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">{t("admin.cleanup.r2Summary", { count: job.objectCount, size: bytes(job.objectSizeBytes, locale) })}</p>
      <p>{t("admin.cleanup.archivesSummary", { versions: job.archiveCount, files: job.archiveFileCount, size: bytes(job.archiveSizeBytes, locale) })}</p>
      <p className="text-muted">{t("admin.cleanup.missingObjects", { count: job.missingObjectCount })}</p>
    </div>
  );
}

function validGraceDays(value: string): boolean {
  return /^\d+$/.test(value) && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 3650;
}

function bytes(value: number, locale: UiLocale): string {
  if (value < 1024) return `${value.toLocaleString(locale)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length);
  return `${(value / 1024 ** power).toLocaleString(locale, { maximumFractionDigits: 2 })} ${units[power - 1]}（${value.toLocaleString(locale)} B）`;
}

function restoreFocus(button: HTMLButtonElement | null, fallback: HTMLParagraphElement | null): void {
  if (button && !button.disabled) button.focus();
  else fallback?.focus();
}

function statusText(job: GcJobReport | null, activity: Activity | null, stop: "pause" | "cancel" | null, t: ReturnType<typeof useMessages>): string {
  if (stop) return stop === "cancel" ? t("admin.cleanup.waitCancel") : t("admin.cleanup.waitPause");
  if (activity === "recovering" || activity === "refreshing") return t("admin.cleanup.loading");
  if (activity === "starting" || activity === "scanning") return t("admin.cleanup.scanning", { count: job?.totalItems ?? 0 });
  if (activity === "confirming") return t("admin.cleanup.confirming");
  if (activity === "running" || activity === "retrying") return t("admin.cleanup.running", { count: job?.processedItems ?? 0, total: job?.totalItems ?? 0 });
  if (activity === "cancelling" || activity === "discarding") return t("admin.cleanup.discarding");
  if (!job) return t("admin.cleanup.stepScan");
  if (job.status === "scanning") return t("admin.cleanup.scanPaused");
  if (job.status === "ready") return t("admin.cleanup.stepConfirm");
  if (job.status === "running") return t("admin.cleanup.saved");
  if (job.status === "needs_retry") return t("admin.cleanup.retryReady");
  if (job.status === "cancelled") return t("admin.cleanup.canceled");
  return t("admin.cleanup.done");
}
import { formatExactTimestamp } from "@/lib/format";
