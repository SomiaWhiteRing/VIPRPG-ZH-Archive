import { requireAdmin } from "@/lib/server/auth/guards";
import { json, jsonError } from "@/lib/server/http/json";
import { runStorageConsistencyCheck } from "@/lib/server/storage/admin-storage-checks";

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
      report: await runStorageConsistencyCheck({
        dbSampleLimit: parseOptionalInteger(url.searchParams.get("db_limit")),
        r2ScanLimit: parseOptionalInteger(url.searchParams.get("r2_limit")),
      }),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError("Admin consistency check failed", error);
  }
}

function parseOptionalInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}
