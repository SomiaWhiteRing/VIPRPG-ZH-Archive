import { requireAnyPermission } from "@/app/.server/auth/authorize";
import {
  addCatalogItem,
  removeCatalogItem,
  updateCatalogItem,
} from "@/app/.server/db/catalogs";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { id: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "catalog.reorder_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await readJsonObject(
      request,
      "Invalid catalog item body",
    )) as {
      workId?: number;
      note?: string | null;
    };
    const workId = body.workId;
    if (
      typeof workId !== "number" ||
      !Number.isSafeInteger(workId) ||
      workId <= 0
    )
      return json({ ok: false, error: "workId is required" }, { status: 400 });
    return json({
      ok: true,
      catalog: await addCatalogItem(
        runtime,
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
  runtime: AppRuntime,
  request: Request,
  context: { params: { id: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "catalog.reorder_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid catalog item body");
    return json({
      ok: true,
      catalog: await updateCatalogItem(
        runtime,
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
  runtime: AppRuntime,
  request: Request,
  context: { params: { id: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "catalog.reorder_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const catalogId = parsePositiveId((await context.params).id, "catalog id");
    const workId = Number(
      new URL(request.url).searchParams.get("workId") ?? "",
    );
    if (!Number.isSafeInteger(workId) || workId <= 0)
      return json({ ok: false, error: "workId is required" }, { status: 400 });
    return json({
      ok: true,
      catalog: await removeCatalogItem(runtime, catalogId, workId, auth.user),
    });
  } catch (error) {
    return jsonError("Catalog item deletion failed", error);
  }
}
