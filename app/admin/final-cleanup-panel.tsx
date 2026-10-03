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
import type { GcJobAction, GcJobReport } from "@/lib/archive/gc-job";
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
  }, "清理任务请求失败");
  if (payload.job === undefined) throw new Error("服务器未返回清理任务，请重新读取状态");
  if (request.jobId && payload.job?.id !== request.jobId) {
    throw new Error("任务状态与当前计划不一致，请重新读取状态");
  }
  return payload.job;
}

function requireJob(job: GcJobReport | null): GcJobReport {
  if (!job) throw new Error("未找到清理任务，请重新读取状态");
  return job;
}

export function FinalCleanupPanel() {
  const [job, setJob] = useState<GcJobReport | null>(null);
  const [graceDays, setGraceDays] = useState(String(gcManualSweepGraceDays));
  const [activity, setActivity] = useState<Activity | null>("recovering");
  const [error, setError] = useState<string | null>(null);
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
        setError(failure instanceof Error ? failure.message : "读取任务失败");
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
        setError(failure instanceof Error ? failure.message : "清理请求失败");
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
      <h4 className="font-semibold" id="final-cleanup-heading">最终清理</h4>
      <p className="text-sm text-muted">
        先查找并核对清理候选，再确认永久删除。自动清理仍保留 {gcDefaultGraceDays} 天；手动可填 0 立即清理。
        批次推进需要保持本页打开；刷新或离开后可恢复任务，但不会自动继续删除。
      </p>
      <div className="max-w-sm space-y-2">
        <Label htmlFor="gc-sweep-grace-days">手动保留天数</Label>
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
          {graceValid ? "0–3650 的整数。扫描开始后，本次保留天数和范围固定。" : "请输入 0–3650 之间的整数。"}
        </p>
      </div>
      <p aria-live="polite" className="text-sm" ref={statusRef} role="status" tabIndex={-1}>
        {statusText(job, activity, stopRequested)}
      </p>
      {error ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm" role="alert">
          <p>{error}</p>
          <p>请求已停止。服务端可能已完成当前批次，任务仍保留；请先刷新任务状态，再决定是否继续。</p>
        </div>
      ) : null}
      {safetyBlocked ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm" role="alert">
          <p>检测到持续超过 10 分钟或时间未知的安全锁，已暂停继续操作。</p>
          <p>
            {job?.safetyLocks.staleExecution ? "本任务的执行锁尚未释放。" : ""}
            {job?.safetyLocks.staleManifestCount ? `另有 ${number(job.safetyLocks.staleManifestCount)} 个清单删除锁尚未释放。` : ""}
            删除请求可能仍在途中；这不代表服务端已安全停止。
          </p>
          <p>请先刷新任务状态；若锁仍保留，请管理员核实执行状态后处理。系统不会因超时自动接管或解除保护。</p>
        </div>
      ) : null}
      {job ? (
        <div className="space-y-3 rounded-md border border-border p-3 text-sm">
          <p className="break-all text-muted">任务 {job.id} · 保留 {job.graceDays} 天 · 创建于 {formatExactTimestamp(job.createdAt)}</p>
          {scanning ? (
            <p>当前阶段：{phaseLabels[job.phase]}；已核对 {number(job.totalItems)} 个清理候选。扫描完成后显示最终总量，才能执行删除。</p>
          ) : job.status === "cancelled" ? (
            <p>此计划已取消，不提供可执行的范围汇总。如需清理，请重新完整扫描。</p>
          ) : (
            <CleanupSummary job={job} />
          )}
          {job.confirmedAt ? (
            <div className="space-y-2">
              <Label htmlFor="gc-sweep-progress">已处理 {number(job.processedItems)} / {number(job.totalItems)} 个计划项</Label>
              <progress className="h-3 w-full" id="gc-sweep-progress" max={Math.max(1, job.totalItems)} value={Math.min(job.processedItems, Math.max(1, job.totalItems))} />
              <p>已清理归档版本 {number(job.purgedArchiveCount)} 个；已完成删除的 R2 对象 {number(job.deletedObjectCount)} 个，{bytes(job.deletedSizeBytes)}（按扫描快照累计）</p>
              <p>已跳过 {number(job.skippedCount)} 项（仍有引用、状态变化或已不存在）；失败 {number(job.failedCount)} 项</p>
            </div>
          ) : null}
          {job.status === "needs_retry" ? (
            <p className="text-destructive">部分项目失败。重试只处理此快照中的失败项，已成功或跳过的项目不会重做，原确认继续有效。</p>
          ) : null}
          {job.failures.length > 0 ? (
            <details>
              <summary className="cursor-pointer">查看失败摘要（显示 {number(job.failures.length)} / {number(job.failedCount)} 项）</summary>
              <ul className="mt-2 list-inside list-disc space-y-1 break-all">
                {job.failures.map((failure, index) => <li key={`${failure.type}:${failure.key}:${index}`}>{failure.type} · {failure.key}：{failure.error}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {!job ? <Button disabled={blocked || !graceValid} onClick={() => void start()} type="button">扫描最终清理范围</Button> : null}
        {scanning && !busy ? <Button disabled={blocked} onClick={() => void perform("scanning", () => advance(job, "scan"))} type="button">继续扫描</Button> : null}
        {scanning ? <Button disabled={needsRefresh || stopRequested === "cancel" || (busy && activity !== "scanning")} onClick={() => void cancelScan()} type="button" variant="outline">取消扫描计划</Button> : null}
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
          >核对并确认清理</Button>
        ) : null}
        {job?.status === "running" && !busy ? <Button disabled={blocked} onClick={() => void perform("running", () => advance(job, "run"))} type="button" variant="destructive">继续已确认的清理</Button> : null}
        {job?.status === "needs_retry" ? <Button disabled={blocked} onClick={() => void retry()} type="button" variant="destructive">只重试失败项</Button> : null}
        {canPause ? <Button disabled={stopRequested !== null} onClick={() => requestStop(false)} type="button" variant="outline">当前批次后暂停</Button> : null}
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
          >放弃此计划，准备新扫描</Button>
        ) : null}
        <Button disabled={busy} onClick={() => void refresh()} type="button" variant="outline">刷新任务状态</Button>
      </div>
      <AlertDialog onOpenChange={(open) => { setConfirmOpen(open); if (!open) setConfirmation(""); }} open={confirmOpen}>
        <AlertDialogContent id="admin-sweep-confirm-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(reviewButtonRef.current, statusRef.current); }}>
          <AlertDialogTitle>永久删除本次快照中的对象？</AlertDialogTitle>
          <AlertDialogDescription>
            此操作不可恢复。保留天数为 {job?.graceDays ?? 0} 天，仅处理下方已完成扫描的快照，不会扩大到后来新增的候选项。
            仍被其他版本引用的共享文件会保留；执行前再次检查引用和状态，有变化的项目会跳过。
          </AlertDialogDescription>
          {job?.status === "ready" ? <CleanupSummary job={job} /> : null}
          <div className="space-y-2">
            <Label htmlFor="gc-sweep-confirm">输入 SWEEP 确认永久删除</Label>
            <Input autoCapitalize="off" autoCorrect="off" id="gc-sweep-confirm" onChange={(event) => setConfirmation(event.target.value)} spellCheck={false} value={confirmation} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button type="button" variant="outline">返回核对</Button></AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button disabled={blocked || confirmation !== "SWEEP" || job?.status !== "ready"} onClick={(event) => { event.preventDefault(); void confirm(); }} type="button" variant="destructive">确认并开始永久清理</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog onOpenChange={setDiscardOpen} open={discardOpen}>
        <AlertDialogContent id="admin-sweep-discard-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(discardButtonRef.current, statusRef.current); }}>
          <AlertDialogTitle>放弃此计划并准备新扫描？</AlertDialogTitle>
          <AlertDialogDescription>当前扫描结果不会用于新任务。你可以重新设置保留天数，完整扫描后再次确认范围。已经删除的数据不能恢复。</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button type="button" variant="outline">保留当前计划</Button></AlertDialogCancel>
            <AlertDialogAction asChild><Button disabled={blocked} onClick={(event) => { event.preventDefault(); void discard(); }} type="button">放弃并重新设置</Button></AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function CleanupSummary({ job }: { job: GcJobReport }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">本次快照计划清理的实际 R2 总量：{number(job.objectCount)} 个对象，{bytes(job.objectSizeBytes)}</p>
      <p>归档版本逻辑汇总：{number(job.archiveCount)} 个版本、{number(job.archiveFileCount)} 个文件引用、{bytes(job.archiveSizeBytes)}。逻辑大小不计入上方 R2 总量。</p>
      <p className="text-muted">扫描时已不存在的对象：{number(job.missingObjectCount)} 个，不计入实际 R2 总量。共享且仍被引用的文件会保留；执行时引用或状态变化也会跳过。</p>
    </div>
  );
}

function validGraceDays(value: string): boolean {
  return /^\d+$/.test(value) && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 3650;
}

function number(value: number): string {
  return value.toLocaleString("zh-CN");
}

function bytes(value: number): string {
  if (value < 1024) return `${number(value)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length);
  return `${(value / 1024 ** power).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${units[power - 1]}（${number(value)} B）`;
}

function restoreFocus(button: HTMLButtonElement | null, fallback: HTMLParagraphElement | null): void {
  if (button && !button.disabled) button.focus();
  else fallback?.focus();
}

const phaseLabels = { archives: "归档版本", blobs: "文件对象", core_packs: "核心包", manifests: "归档清单" };

function statusText(job: GcJobReport | null, activity: Activity | null, stop: "pause" | "cancel" | null): string {
  if (stop) return stop === "cancel" ? "等待当前扫描批次完成后取消计划；尚未执行删除。" : "等待当前批次完成后暂停；已经开始的批次不会被撤销。";
  if (activity === "recovering" || activity === "refreshing") return "正在读取已保存的任务状态…";
  if (activity === "starting" || activity === "scanning") return `正在查找并核对清理候选，尚未删除数据。已核对 ${number(job?.totalItems ?? 0)} 项。`;
  if (activity === "confirming") return "正在保存本次永久清理确认…";
  if (activity === "running" || activity === "retrying") return `正在按已确认快照分批清理：已处理 ${number(job?.processedItems ?? 0)} / ${number(job?.totalItems ?? 0)} 项。`;
  if (activity === "cancelling" || activity === "discarding") return "正在放弃扫描计划…";
  if (!job) return "第 1 步：完整扫描清理范围。此步骤不会删除数据。";
  if (job.status === "scanning") return "扫描已暂停或恢复，点击继续扫描以完成范围汇总。";
  if (job.status === "ready") return "第 2 步：扫描已完成。请核对总量，再确认永久清理。";
  if (job.status === "running") return "清理任务已保存，当前页面未继续推进。可继续已确认的清理；其他页面或已发出的批次可能仍在运行。";
  if (job.status === "needs_retry") return "本轮已结束，有失败项等待重试。";
  if (job.status === "cancelled") return "扫描计划已取消，未执行删除。";
  return "本次清理已完成。跳过项未删除；新增候选项需要重新扫描。";
}
import { formatExactTimestamp } from "@/lib/format";
