import { requirePermission } from "@/app/.server/auth/authorize";
import { getAdminSummary } from "@/app/.server/db/admin-summary";
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
      summary: await getAdminSummary(runtime),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError("Admin summary failed", error);
  }
}
