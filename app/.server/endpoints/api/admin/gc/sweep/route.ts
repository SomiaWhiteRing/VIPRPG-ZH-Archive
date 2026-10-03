import { readJsonObject } from "@/app/.server/http/request";
import { requirePermission } from "@/app/.server/auth/authorize";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import type { AppRuntime } from "@/app/.server/runtime";
import { runGcSweep } from "@/app/.server/storage/admin-storage-checks";
import { handleManualGc } from "@/app/.server/storage/manual-gc";
import type { GcJobAction } from "@/lib/archive/gc-job";
import { HttpError, json, jsonError } from "@/lib/http";

type SweepRequestBody = {
  action?: GcJobAction;
  jobId?: string;
  confirm?: string;
  graceDays?: number;
  limitPerType?: number;
};

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requirePermission(runtime, request, "storage.gc.sweep");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const body = await readBody(request);

    if (body.action !== undefined) {
      if (!["start", "scan", "status", "confirm", "run", "retry", "cancel"].includes(body.action)
        || (body.jobId !== undefined && typeof body.jobId !== "string")) {
        throw new HttpError(400, "无效的清理任务请求");
      }
      return json({ ok: true, job: await handleManualGc(runtime, auth.user, { ...body, action: body.action }) });
    }

    // Preserve the existing bounded API for approved maintenance clients. The
    // interactive UI uses the snapshot actions above and never expands a plan.
    if (body.confirm !== "SWEEP") {
      return json(
        {
          ok: false,
          error: "GC sweep requires confirm=SWEEP",
        },
        { status: 400 },
      );
    }

    const report = await runGcSweep(runtime, {
      graceDays: parseOptionalInteger(body.graceDays),
      limitPerType: parseOptionalInteger(body.limitPerType),
    });

    await writeAuthAuditLog(runtime, {
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "gc_sweep",
      detail: {
        graceDays: report.graceDays,
        limitPerType: report.limitPerType,
        purgedArchiveVersionCount: report.archiveVersions.purgedCount,
        purgedArchiveVersionFileCount: report.archiveVersions.purgedFileCount,
        purgedArchiveVersionSizeBytes: report.archiveVersions.purgedSizeBytes,
        purgedBlobCount: report.blobs.purgedCount,
        purgedCorePackCount: report.corePacks.purgedCount,
        purgedBlobSizeBytes: report.blobs.purgedSizeBytes,
        purgedCorePackSizeBytes: report.corePacks.purgedSizeBytes,
      },
    });

    return json({
      ok: true,
      report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError("Admin GC sweep failed", error);
  }
}

async function readBody(request: Request): Promise<SweepRequestBody> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body: unknown = await readJsonObject(request, "请求必须为 JSON 对象");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "请求必须为 JSON 对象");
    return body as SweepRequestBody;
  }

  const formData = await request.formData();

  return {
    confirm: stringOrUndefined(formData.get("confirm")),
    graceDays: numberOrUndefined(formData.get("grace_days")),
    limitPerType: numberOrUndefined(formData.get("limit_per_type")),
  };
}

function parseOptionalInteger(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(
  value: FormDataEntryValue | null,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(
  value: FormDataEntryValue | null,
): number | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}
