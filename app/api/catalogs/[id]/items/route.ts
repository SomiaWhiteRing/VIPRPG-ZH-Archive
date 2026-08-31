import { requireAnyPermission } from "@/lib/server/auth/authorize";
import {
  addCatalogItem,
  removeCatalogItem,
  updateCatalogItem,
} from "@/lib/server/db/catalogs";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "catalog.reorder_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await readJsonObject(request, "Invalid catalog item body")) as {
      workId?: number;
      note?: string | null;
    };
    const workId = body.workId;
    if (typeof workId !== "number" || !Number.isSafeInteger(workId) || workId <= 0)
      return json({ ok: false, error: "workId is required" }, { status: 400 });
    return json({
      ok: true,
      catalog: await addCatalogItem(
        parsePositiveId((await context.params).id, "catalog id"),
        workId,
        body.note,
        auth.user,
      ),
    });
  } catch (error) {
    return jsonError("Catalog item update failed", error);
  }
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "catalog.reorder_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid catalog item body");
    return json({
      ok: true,
      catalog: await updateCatalogItem(
        parsePositiveId((await context.params).id, "catalog id"),
        body.workId,
        body.sortOrder,
        body.note,
        auth.user,
      ),
    });
  } catch (error) {
    return jsonError("Catalog item update failed", error);
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "catalog.reorder_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const catalogId = parsePositiveId(
      (await context.params).id,
      "catalog id",
    );
    const workId = Number(
      new URL(request.url).searchParams.get("workId") ?? "",
    );
    if (!Number.isSafeInteger(workId) || workId <= 0)
      return json({ ok: false, error: "workId is required" }, { status: 400 });
    return json({
      ok: true,
      catalog: await removeCatalogItem(catalogId, workId, auth.user),
    });
  } catch (error) {
    return jsonError("Catalog item deletion failed", error);
  }
}
