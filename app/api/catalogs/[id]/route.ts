import { requireAnyPermission } from "@/lib/server/auth/authorize";
import { deleteCatalog, updateCatalog } from "@/lib/server/db/catalogs";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "catalog.update_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await readJsonObject(request, "Invalid catalog body")) as {
      title?: string;
      description?: string | null;
      slug?: string | null;
    };
    return json({
      ok: true,
      catalog: await updateCatalog(
        parsePositiveId((await context.params).id, "catalog id"),
        body,
        auth.user,
      ),
    });
  } catch (error) {
    return jsonError("Catalog update failed", error);
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "catalog.delete_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    await deleteCatalog(
      parsePositiveId((await context.params).id, "catalog id"),
      auth.user,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Catalog deletion failed", error);
  }
}
