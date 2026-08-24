import { requirePermission } from "@/lib/server/auth/authorize";
import { getAdminObservability } from "@/lib/server/db/admin-observability";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requirePermission(request, "system.dashboard.read");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    return json({
      ok: true,
      observability: await getAdminObservability(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError("Admin observability failed", error);
  }
}
