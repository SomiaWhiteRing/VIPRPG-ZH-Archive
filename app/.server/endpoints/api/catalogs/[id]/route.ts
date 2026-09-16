import { requireAnyPermission } from "@/app/.server/auth/authorize";
import {
  assertCatalogUpdateAllowed,
  deleteCatalog,
  updateCatalog,
} from "@/app/.server/db/catalogs";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import {
  readWorkImage,
  storeWorkImages,
} from "@/app/.server/storage/work-images";
import { HttpError, json, jsonError } from "@/lib/http";

export async function PATCH(
  runtime: AppRuntime,
  request: Request,
  context: { params: { id: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "catalog.update_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const id = parsePositiveId((await context.params).id, "catalog id");
    await assertCatalogUpdateAllowed(runtime, id, auth.user);
    const form = await request.formData();
    const coverEntry = form.get("cover");
    const coverBlobSha256 =
      coverEntry === null
        ? undefined
        : (
            await storeWorkImages(runtime, [
              readWorkImage(coverEntry, "目录封面"),
            ])
          )[0];
    return json({
      ok: true,
      catalog: await updateCatalog(
        runtime,
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
  if (typeof value !== "string")
    throw new HttpError(400, `${field}必须是字符串`);
  return value;
}
export async function DELETE(
  runtime: AppRuntime,
  request: Request,
  context: { params: { id: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "catalog.delete_own",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    await deleteCatalog(
      runtime,
      parsePositiveId((await context.params).id, "catalog id"),
      auth.user,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Catalog deletion failed", error);
  }
}
