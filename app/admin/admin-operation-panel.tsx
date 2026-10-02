import { FinalCleanupPanel } from "@/app/admin/final-cleanup-panel";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";

import { SectionHeading } from "@/app/components/ui/section-heading";
import {
  gcDefaultGraceDays,
  gcDefaultSweepLimitPerType,
} from "@/lib/archive/gc-policy";
import { useRef, useState } from "react";

type OperationKind = "consistency" | "gc";

type OperationState = {
  kind: OperationKind | null;
  loading: boolean;
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
  const toast = useToast();
  const requestPendingRef = useRef(false);
  const [state, setState] = useState<OperationState>({
    kind: null,
    loading: false,
    result: null,
  });
  async function run(kind: OperationKind): Promise<void> {
    if (requestPendingRef.current) return;
    requestPendingRef.current = true;
    const url = operationUrl(kind);

    setState({
      kind,
      loading: true,
      result: null,
    });

    try {
      const response = await fetch(url, {
        credentials: "same-origin",
      });
      const payload = (await response.json()) as ApiPayload;

      if (!response.ok || payload.ok === false) {
        throw new Error(
          payload.detail ??
            payload.error ??
            `Request failed: ${response.status}`,
        );
      }

      setState({
        kind,
        loading: false,
        result: summarize(kind, payload.report),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
      setState({
        kind,
        loading: false,
        result: null,
      });
    } finally {
      requestPendingRef.current = false;
    }
  }

  return (
    <div className="mt-5">
      <SectionHeading level={3} title="运维检查" />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={state.loading}
          onClick={() => run("consistency")}
          type="button"
        >
          运行一致性检查
        </Button>
        <Button
          variant="outline"
          disabled={state.loading}
          onClick={() => run("gc")}
          type="button"
        >
          运行清理预演
        </Button>
      </div>
      {canRunFinalCleanup ? (
        <FinalCleanupPanel />
      ) : (
        <p className="text-sm text-muted">
          最终清理会永久删除回收站版本的文件引用和零引用 R2
          对象，只有超级管理员可手动执行。
        </p>
      )}
      {state.loading ? <p className="text-sm text-muted">检查运行中</p> : null}
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

  return `/api/admin/gc/dry-run?grace_days=${gcDefaultGraceDays}&limit=${gcDefaultSweepLimitPerType}`;
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
