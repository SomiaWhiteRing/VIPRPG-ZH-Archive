import { readJsonObject } from "@/app/.server/http/request";
import { requirePermission } from "@/app/.server/auth/authorize";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import type { AppRuntime } from "@/app/.server/runtime";
import { runGcSweep } from "@/app/.server/storage/admin-storage-checks";
import { handleManualGc } from "@/app/.server/storage/manual-gc";
import type { GcJobAction } from "@/lib/archive/gc-job";
import { UiHttpError } from "@/lib/i18n/feedback";
import { translate } from "@/lib/i18n/core";
import type { UiLocale } from "@/lib/i18n/locale";
import { json, jsonError } from "@/lib/http";

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
    const body = await readBody(request, runtime.uiLocale);

    if (body.action !== undefined) {
      if (!["start", "scan", "status", "confirm", "run", "retry", "cancel"].includes(body.action)
        || (body.jobId !== undefined && typeof body.jobId !== "string")) {
        throw new UiHttpError(400, "admin.cleanup.error.invalidRequest");
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
          messageKey: "admin.cleanup.error.confirm",
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

async function readBody(request: Request, locale: UiLocale): Promise<SweepRequestBody> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return await readJsonObject(request, translate(locale, "admin.cleanup.error.json")) as SweepRequestBody;
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
