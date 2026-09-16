import { requirePermission } from "@/app/.server/auth/authorize";
import type { AppRuntime } from "@/app/.server/runtime";
import { runGcDryRun } from "@/app/.server/storage/admin-storage-checks";
import { json, jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request) {
  const auth = await requirePermission(
    runtime,
    request,
    "system.maintenance.run",
  );

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);

    return json({
      ok: true,
      report: await runGcDryRun(runtime, {
        graceDays: parseOptionalInteger(url.searchParams.get("grace_days")),
        sampleLimit: parseOptionalInteger(url.searchParams.get("limit")),
      }),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError("Admin GC dry-run failed", error);
  }
}

function parseOptionalInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}
