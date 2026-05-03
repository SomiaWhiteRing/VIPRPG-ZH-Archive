import { requireAdmin } from "@/lib/server/auth/guards";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { parseSeriesEditForm, updateSeriesForAdmin } from "@/lib/server/db/taxonomy-library";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    seriesId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { seriesId: rawSeriesId } = await context.params;
    const seriesId = parseId(rawSeriesId);
    const formData = await request.formData();
    const input = parseSeriesEditForm(formData);

    if (input.seriesId !== seriesId) {
      throw new Error("Series id mismatch");
    }

    const series = await updateSeriesForAdmin(input);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_series_update",
      detail: {
        seriesId: series.id,
        slug: series.slug,
        status: series.status,
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        series: {
          id: series.id,
          slug: series.slug,
          title: series.title,
          titleOriginal: series.titleOriginal,
          status: series.status,
          workCount: series.workCount,
        },
      });
    }

    return redirectResponse(new URL(`/admin/series/${series.id}`, request.url));
  } catch (error) {
    return jsonError("Series update failed", error);
  }
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid series id");
  }

  return id;
}
