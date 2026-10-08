import { findWorksByMaterialHash } from "@/app/.server/db/material-search";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";
import { normalizeSha256 } from "@/lib/sha256";

export async function GET(runtime: AppRuntime, request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    let sha256: string;
    try {
      sha256 = normalizeSha256(params.get("sha256") ?? "");
    } catch {
      throw new HttpError(400, "素材哈希不合法");
    }
    const cursor = params.get("before");
    const before = cursor === null ? undefined : parsePositiveId(cursor, "cursor", "分页位置不合法");
    return json({ ok: true, ...await findWorksByMaterialHash(runtime, sha256, before) });
  } catch (error) {
    return jsonError("素材搜索失败", error);
  }
}
