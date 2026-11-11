import type { AppRuntime } from "@/app/.server/runtime";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { workReadCondition } from "@/app/.server/db/work-visibility";
import { parsePositiveId } from "@/app/.server/http/request";
import { HttpError } from "@/lib/http";

export async function listNetplaySpaces(runtime: AppRuntime) {
  const { results } = await runtime.db.prepare(
    "SELECT id, name, external_endpoint FROM netplay_spaces ORDER BY name, id",
  ).all<{ id: number; name: string; external_endpoint: string | null }>();
  return results;
}

export async function getWorkNetplaySpaceId(runtime: AppRuntime, workId: number) {
  return (await runtime.db.prepare("SELECT netplay_space_id FROM works WHERE id=?")
    .bind(workId).first<number>("netplay_space_id")) ?? null;
}

export async function isCloudflareSpaceReadable(runtime: AppRuntime, spaceId: number) {
  const access = workReadCondition(await getCurrentUser(runtime));
  return !!await runtime.db.prepare(
    `SELECT 1 FROM netplay_spaces s JOIN works w ON w.netplay_space_id=s.id
     JOIN archive_versions av ON av.work_id=w.id
     WHERE s.id=? AND s.external_endpoint IS NULL
       AND av.is_current=1 AND av.status='published' AND av.purged_at IS NULL
       AND av.netplay_service IS NOT NULL AND ${access.sql} LIMIT 1`,
  ).bind(spaceId, ...access.binds).first();
}

export async function saveNetplaySpace(runtime: AppRuntime, form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80) throw new HttpError(400, "请输入 1 至 80 个字符的空间名称");
  const provider = form.get("provider");
  let endpoint: string | null = null;
  if (provider === "external") {
    const raw = String(form.get("external_endpoint") ?? "").trim();
    const url = raw.length <= 2048 && URL.canParse(raw) ? new URL(raw) : null;
    if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new HttpError(400, "请输入不含账号、参数或片段的 HTTPS 联机地址");
    }
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    endpoint = url.href;
  } else if (provider !== "cloudflare") {
    throw new HttpError(400, "联机托管方式无效");
  }
  const rawId = form.get("space_id");
  if (rawId === null) {
    await runtime.db.prepare("INSERT INTO netplay_spaces(name,external_endpoint) VALUES (?,?)")
      .bind(name, endpoint).run();
  } else {
    const id = parsePositiveId(String(rawId));
    const result = await runtime.db.prepare("UPDATE netplay_spaces SET name=?,external_endpoint=? WHERE id=?")
      .bind(name, endpoint, id).run();
    if (!result.meta.changes) throw new HttpError(404, "联机空间不存在");
  }
}

export async function setWorkNetplaySpace(runtime: AppRuntime, workId: number, spaceId: number | null) {
  if (spaceId !== null && !await runtime.db.prepare("SELECT 1 FROM netplay_spaces WHERE id=?").bind(spaceId).first()) {
    throw new HttpError(404, "联机空间不存在");
  }
  const result = await runtime.db.prepare("UPDATE works SET netplay_space_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'deleted'")
    .bind(spaceId, workId).run();
  if (!result.meta.changes) throw new HttpError(404, "作品不存在");
}
