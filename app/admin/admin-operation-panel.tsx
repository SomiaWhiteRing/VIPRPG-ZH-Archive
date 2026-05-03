"use client";

import {
  gcDefaultGraceDays,
  gcDefaultSweepLimitPerType,
  gcManualSweepGraceDays,
} from "@/lib/archive/gc-policy";
import { useState } from "react";

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

export function AdminOperationPanel({
  canRunFinalCleanup,
}: {
  canRunFinalCleanup: boolean;
}) {
  const [state, setState] = useState<OperationState>({
    kind: null,
    loading: false,
    error: null,
    result: null,
  });
  const [sweepConfirm, setSweepConfirm] = useState("");
  const [sweepGraceDays, setSweepGraceDays] = useState(
    String(gcManualSweepGraceDays),
  );

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
    <section className="card" style={{ marginTop: 16 }}>
      <h2>运维检查</h2>
      <div className="actions">
        <button
          className="button primary"
          disabled={state.loading}
          onClick={() => run("consistency")}
          type="button"
        >
          运行一致性检查
        </button>
        <button
          className="button"
          disabled={state.loading}
          onClick={() => run("gc")}
          type="button"
        >
          运行清理预演
        </button>
      </div>
      {canRunFinalCleanup ? (
        <div className="danger-inline-controls">
          <label htmlFor="gc-sweep-confirm">
            最终清理
            <span className="muted-line">
              自动任务最终清理超过 {gcDefaultGraceDays} 天的回收站版本和零引用对象；
              手动可填 0 立即清理，每轮每类最多 {gcDefaultSweepLimitPerType} 个对象。
            </span>
          </label>
          <input
            aria-label="最终清理手动保留天数"
            min="0"
            step="1"
            type="number"
            value={sweepGraceDays}
            onChange={(event) => setSweepGraceDays(event.target.value)}
          />
          <input
            id="gc-sweep-confirm"
            value={sweepConfirm}
            onChange={(event) => setSweepConfirm(event.target.value)}
            placeholder="SWEEP"
          />
          <button
            className="button"
            disabled={state.loading || sweepConfirm !== "SWEEP"}
            onClick={() => run("sweep")}
            type="button"
          >
            执行最终清理
          </button>
        </div>
      ) : (
        <p className="muted-line">
          最终清理会永久删除回收站版本的文件引用和零引用 R2 对象，只有超级管理员可手动执行。
        </p>
      )}
      {state.loading ? <p className="muted-line">检查运行中</p> : null}
      {state.error ? <p className="error-message compact">{state.error}</p> : null}
      {state.result ? (
        <pre className="code-block compact-code">{JSON.stringify(state.result, null, 2)}</pre>
      ) : null}
    </section>
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
