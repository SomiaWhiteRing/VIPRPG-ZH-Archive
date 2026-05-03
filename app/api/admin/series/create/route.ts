import { requireAdmin } from "@/lib/server/auth/guards";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import {
  createSeriesForAdmin,
  parseSeriesCreateForm,
} from "@/lib/server/db/taxonomy-library";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const formData = await request.formData();
    const series = await createSeriesForAdmin(parseSeriesCreateForm(formData));

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_series_create",
      detail: {
        seriesId: series.id,
        slug: series.slug,
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({ ok: true, series });
    }

    return redirectResponse(new URL(`/admin/series/${series.id}`, request.url));
  } catch (error) {
    return jsonError("Series create failed", error);
  }
}
