import { getCurrentUser } from "@/app/.server/auth/current-user";
import { requireAnyPermission } from "@/app/.server/auth/authorize";
import { createCatalog, listCatalogs, searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import { readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("owner") === "me") {
      const user = await getCurrentUser(runtime);
      if (!user) return json({ok:false,error:"请先登录"}, {status:401});
      const rawPage = Number(params.get("page") ?? 1);
      const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
      const result = await searchCatalogsForOwner(runtime, {userId:user.id,query:params.get("q") ?? "",page});
      return json({ok:true,...result}, {headers:{"Cache-Control":"private, no-store"}});
    }
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
