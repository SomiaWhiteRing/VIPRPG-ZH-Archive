import { requirePermission } from "@/app/.server/auth/authorize";
import { getAdminObservability } from "@/app/.server/db/admin-observability";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request) {
  const auth = await requirePermission(
    runtime,
    request,
    "system.dashboard.read",
  );

  if ("response" in auth) {
    return auth.response;
  }

  try {
    return json({
      ok: true,
      observability: await getAdminObservability(runtime),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError("Admin observability failed", error);
  }
}
