import { requireAdmin } from "@/lib/server/auth/guards";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { json, jsonError } from "@/lib/server/http/json";
import { runGcSweep } from "@/lib/server/storage/admin-storage-checks";

export const dynamic = "force-dynamic";

type SweepRequestBody = {
  confirm?: string;
  graceDays?: number;
  limitPerType?: number;
};

export async function POST(request: Request) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const body = await readBody(request);

    if (body.confirm !== "SWEEP") {
      return json(
        {
          ok: false,
          error: "GC sweep requires confirm=SWEEP",
        },
        { status: 400 },
      );
    }

    const report = await runGcSweep({
      graceDays: parseOptionalInteger(body.graceDays),
      limitPerType: parseOptionalInteger(body.limitPerType),
    });

    await writeAuthAuditLog({
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
    return (await request.json()) as SweepRequestBody;
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

function stringOrUndefined(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}
