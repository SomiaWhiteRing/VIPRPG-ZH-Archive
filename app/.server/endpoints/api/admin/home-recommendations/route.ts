import { requireBootstrapAdmin } from "@/app/.server/auth/authorize";
import { readHomeRecommendations, saveHomeRecommendations } from "@/app/.server/db/home-recommendations";
import { readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request) {
  const auth = await requireBootstrapAdmin(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    return json({ ok: true, works: await readHomeRecommendations(runtime) });
  } catch (error) {
    return jsonError("站长推荐读取失败", error);
  }
}

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requireBootstrapAdmin(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "站长推荐内容格式不合法。");
    await saveHomeRecommendations(runtime, auth.user, body.workIds);
    return json({ ok: true, works: await readHomeRecommendations(runtime) });
  } catch (error) {
    return jsonError("站长推荐保存失败", error);
  }
}
