import { parseAccountPage } from "@/app/.server/auth/account-user";
import { canReadWork } from "@/app/.server/db/work-visibility";
import { listWorkCollections } from "@/app/.server/db/work-community";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request, context: { params: { workId: string } }) {
  try {
    const workId = parsePositiveId(context.params.workId, "work id");
    if (!await canReadWork(runtime, workId))
      throw new HttpError(404, "作品不存在");
    const params = new URL(request.url).searchParams;
    const page = parseAccountPage(params.get("page") ?? undefined);
    return json({ ok: true, collections: await listWorkCollections(runtime, workId, page, params.get("notes") === "1") });
  } catch (error) {
    return jsonError("收藏列表加载失败", error);
  }
}
