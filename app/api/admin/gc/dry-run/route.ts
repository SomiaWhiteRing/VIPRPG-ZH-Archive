import { requireAdmin } from "@/lib/server/auth/guards";
import { json, jsonError } from "@/lib/server/http/json";
import { runGcDryRun } from "@/lib/server/storage/admin-storage-checks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);

    return json({
      ok: true,
      report: await runGcDryRun({
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
