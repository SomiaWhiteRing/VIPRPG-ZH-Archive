import { requireAnyPermission } from "@/lib/server/auth/authorize";
import {
  assertCatalogUpdateAllowed,
  deleteCatalog,
  updateCatalog,
} from "@/lib/server/db/catalogs";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId } from "@/lib/server/http/request";
import { readWorkImage, storeWorkImages } from "@/lib/server/storage/work-images";

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
    const id = parsePositiveId((await context.params).id, "catalog id");
    await assertCatalogUpdateAllowed(id, auth.user);
    const form = await request.formData();
    const coverEntry = form.get("cover");
    const coverBlobSha256 = coverEntry === null
      ? undefined
      : (await storeWorkImages([readWorkImage(coverEntry, "目录封面")]))[0];
    return json({
      ok: true,
      catalog: await updateCatalog(
        id,
        {
          title: optionalFormString(form.get("title"), "目录标题"),
          description: optionalFormString(form.get("description"), "目录说明"),
          coverBlobSha256,
        },
        auth.user,
      ),
    });
  } catch (error) {
    return jsonError("Catalog update failed", error);
  }
}

function optionalFormString(
  value: FormDataEntryValue | null,
  field: string,
): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${field}必须是字符串`);
  return value;
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
