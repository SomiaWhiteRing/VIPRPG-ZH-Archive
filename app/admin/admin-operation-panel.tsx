"use client";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Label } from "@/app/components/ui/label";

import { SectionHeading } from "@/app/components/ui/section-heading";
import { gcDefaultGraceDays, gcDefaultSweepLimitPerType, gcManualSweepGraceDays } from "@/lib/archive/gc-policy";
import { useRef, useState } from "react";

type OperationKind = "consistency" | "gc" | "sweep";

type OperationState = {
  kind: OperationKind | null;
  loading: boolean;
  error: string | null;
  result: unknown;
};

type ApiPayload = {
  ok?: boolean;
  error?: string;
  detail?: string;
  report?: unknown;
};

export function AdminOperationPanel({ canRunFinalCleanup }: { canRunFinalCleanup: boolean }) {
  const sweepButtonRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<OperationState>({
    kind: null,
    loading: false,
    error: null,
    result: null,
  });
  const [sweepConfirm, setSweepConfirm] = useState("");
  const [sweepDialogOpen, setSweepDialogOpen] = useState(false);
  const [sweepGraceDays, setSweepGraceDays] = useState(String(gcManualSweepGraceDays));

  async function run(kind: OperationKind): Promise<void> {
    const url = operationUrl(kind);

    setState({
      kind,
      loading: true,
      error: null,
      result: null,
    });

    try {
      const response =
        kind === "sweep"
          ? await fetch(url, {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                confirm: sweepConfirm,
                graceDays: parseIntegerInput(sweepGraceDays, gcManualSweepGraceDays),
                limitPerType: gcDefaultSweepLimitPerType,
              }),
            })
          : await fetch(url, {
              credentials: "same-origin",
            });
      const payload = (await response.json()) as ApiPayload;

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.detail ?? payload.error ?? `Request failed: ${response.status}`);
      }

      setState({
        kind,
        loading: false,
        error: null,
        result: summarize(kind, payload.report),
      });
    } catch (error) {
      setState({
        kind,
        loading: false,
        error: error instanceof Error ? error.message : "操作失败",
        result: null,
      });
    }
  }

  return (
    <div className="mt-5">
      <SectionHeading level={3} title="运维检查" />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={state.loading} onClick={() => run("consistency")} type="button">
          运行一致性检查
        </Button>
        <Button variant="outline" disabled={state.loading} onClick={() => run("gc")} type="button">
          运行清理预演
        </Button>
      </div>
      {canRunFinalCleanup ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <Label htmlFor="gc-sweep-confirm">
            最终清理
            <span className="text-sm text-muted">
              此操作会永久删除且不可恢复。 自动任务最终清理超过 {gcDefaultGraceDays} 天的回收站版本和零引用对象；
              手动可填 0 立即清理，每轮每类最多 {gcDefaultSweepLimitPerType} 个对象。
            </span>
          </Label>
          <Input
            aria-label="最终清理手动保留天数"
            min="0"
            step="1"
            type="number"
            value={sweepGraceDays}
            onChange={(event) => setSweepGraceDays(event.target.value)}
          />
          <Input
            id="gc-sweep-confirm"
            value={sweepConfirm}
            onChange={(event) => setSweepConfirm(event.target.value)}
            placeholder="SWEEP"
          />
          <Button
            aria-controls="admin-sweep-confirm-dialog"
            aria-expanded={sweepDialogOpen}
            aria-haspopup="dialog"
            ref={sweepButtonRef}
            variant="outline"
            disabled={state.loading || sweepConfirm !== "SWEEP"}
            onClick={() => setSweepDialogOpen(true)}
            type="button"
          >
            执行最终清理
          </Button>
          <AlertDialog onOpenChange={setSweepDialogOpen} open={sweepDialogOpen}>
            <AlertDialogContent
              id="admin-sweep-confirm-dialog"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                sweepButtonRef.current?.focus();
              }}
            >
              <AlertDialogTitle>确认执行最终清理</AlertDialogTitle>
              <AlertDialogDescription>
                此操作会永久删除回收站版本的文件引用和零引用 R2 对象，不能恢复。只有在确认清理范围正确后继续。
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="outline">取消</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    onClick={() => {
                      setSweepDialogOpen(false);
                      void run("sweep");
                    }}
                    variant="destructive"
                  >
                    确认清理
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <p className="text-sm text-muted">
          最终清理会永久删除回收站版本的文件引用和零引用 R2 对象，只有超级管理员可手动执行。
        </p>
      )}
      {state.loading ? <p className="text-sm text-muted">检查运行中</p> : null}
      {state.error ? (
        <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 text-sm">{state.error}</p>
      ) : null}
      {state.result ? (
        <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted/10 p-3 font-mono text-sm text-xs">
          {JSON.stringify(state.result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function operationUrl(kind: OperationKind): string {
  if (kind === "consistency") {
    return "/api/admin/consistency?db_limit=150&r2_limit=1000";
  }

  if (kind === "gc") {
    return `/api/admin/gc/dry-run?grace_days=${gcDefaultGraceDays}&limit=${gcDefaultSweepLimitPerType}`;
  }

  return "/api/admin/gc/sweep";
}

function parseIntegerInput(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function summarize(kind: OperationKind, report: unknown): unknown {
  if (kind === "consistency") {
    const value = report as {
      checkedAt?: string;
      dbToR2?: {
        checked?: Record<string, number>;
        missing?: unknown[];
        sizeMismatches?: unknown[];
      };
      r2ToD1?: {
        scannedObjects?: number;
        scanComplete?: boolean;
        orphanObjects?: unknown[];
        nonCanonicalObjects?: unknown[];
        zipOutsideCorePack?: unknown[];
      };
    };

    return {
      checkedAt: value.checkedAt,
      checked: value.dbToR2?.checked,
      missing: value.dbToR2?.missing?.length ?? 0,
      sizeMismatches: value.dbToR2?.sizeMismatches?.length ?? 0,
      scannedObjects: value.r2ToD1?.scannedObjects ?? 0,
      scanComplete: value.r2ToD1?.scanComplete ?? false,
      orphanObjects: value.r2ToD1?.orphanObjects?.length ?? 0,
      nonCanonicalObjects: value.r2ToD1?.nonCanonicalObjects?.length ?? 0,
      zipOutsideCorePack: value.r2ToD1?.zipOutsideCorePack?.length ?? 0,
    };
  }

  const value = report as {
    checkedAt?: string;
    graceDays?: number;
    limitPerType?: number;
    archiveVersions?: {
      eligibleCount?: number;
      eligibleFileCount?: number;
      eligibleSizeBytes?: number;
      purgedCount?: number;
      purgedFileCount?: number;
      purgedSizeBytes?: number;
      failedCount?: number;
      skippedCount?: number;
    };
    blobs?: {
      eligibleCount?: number;
      eligibleSizeBytes?: number;
      deletedOnlyReferenceCount?: number;
      purgedCount?: number;
      purgedSizeBytes?: number;
      failedCount?: number;
      skippedCount?: number;
    };
    corePacks?: {
      eligibleCount?: number;
      eligibleSizeBytes?: number;
      deletedOnlyReferenceCount?: number;
      purgedCount?: number;
      purgedSizeBytes?: number;
      failedCount?: number;
      skippedCount?: number;
    };
  };

  return {
    checkedAt: value.checkedAt,
    graceDays: value.graceDays,
    limitPerType: value.limitPerType,
    archiveVersions: value.archiveVersions,
    blobs: value.blobs,
    corePacks: value.corePacks,
  };
}
