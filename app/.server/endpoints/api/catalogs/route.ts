import { requireAnyPermission } from "@/app/.server/auth/authorize";
import { createCatalog, listCatalogs } from "@/app/.server/db/catalogs";
import { readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime) {
  try {
    return json({ ok: true, catalogs: await listCatalogs(runtime) });
  } catch (error) {
    return jsonError("Catalog listing failed", error);
  }
}
export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requireAnyPermission(runtime, request, [
    "catalog.create",
    "catalog.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await readJsonObject(request, "Invalid catalog body")) as {
      title?: string;
      description?: string | null;
    };
    return json(
      { ok: true, catalog: await createCatalog(runtime, body, auth.user) },
      { status: 201 },
    );
  } catch (error) {
    return jsonError("Catalog creation failed", error);
  }
}
