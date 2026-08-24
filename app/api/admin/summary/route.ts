import { requirePermission } from "@/lib/server/auth/authorize";
import { getAdminSummary } from "@/lib/server/db/admin-summary";
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
      summary: await getAdminSummary(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError("Admin summary failed", error);
  }
}
