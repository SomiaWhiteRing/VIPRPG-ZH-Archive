import { requireAnyPermission } from "@/lib/server/auth/authorize";
import { createCatalog, listCatalogs } from "@/lib/server/db/catalogs";
import { json, jsonError } from "@/lib/server/http/json";
import { readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ ok: true, catalogs: await listCatalogs() });
  } catch (error) {
    return jsonError("Catalog listing failed", error);
  }
}
export async function POST(request: Request) {
  const auth = await requireAnyPermission(request, [
    "catalog.create",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await readJsonObject(request, "Invalid catalog body")) as {
      title?: string;
      description?: string | null;
      slug?: string | null;
    };
    return json(
      { ok: true, catalog: await createCatalog(body, auth.user) },
      { status: 201 },
    );
  } catch (error) {
    return jsonError("Catalog creation failed", error);
  }
}
