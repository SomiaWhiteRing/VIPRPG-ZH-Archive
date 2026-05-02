"use client";

import { useState } from "react";

type OperationKind = "consistency" | "gc";

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

export function AdminOperationPanel() {
  const [state, setState] = useState<OperationState>({
    kind: null,
    loading: false,
    error: null,
    result: null,
  });

  async function run(kind: OperationKind): Promise<void> {
    const url =
      kind === "consistency"
        ? "/api/admin/consistency?db_limit=150&r2_limit=1000"
        : "/api/admin/gc/dry-run?grace_days=30&limit=25";

    setState({
      kind,
      loading: true,
      error: null,
      result: null,
    });

    try {
      const response = await fetch(url, {
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
          运行 GC dry-run
        </button>
      </div>
      {state.loading ? <p className="muted-line">检查运行中</p> : null}
      {state.error ? <p className="error-message compact">{state.error}</p> : null}
      {state.result ? (
        <pre className="code-block compact-code">{JSON.stringify(state.result, null, 2)}</pre>
      ) : null}
    </section>
  );
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
    blobs?: {
      eligibleCount?: number;
      eligibleSizeBytes?: number;
      deletedOnlyReferenceCount?: number;
    };
    corePacks?: {
      eligibleCount?: number;
      eligibleSizeBytes?: number;
      deletedOnlyReferenceCount?: number;
    };
  };

  return {
    checkedAt: value.checkedAt,
    graceDays: value.graceDays,
    blobs: value.blobs,
    corePacks: value.corePacks,
  };
}
