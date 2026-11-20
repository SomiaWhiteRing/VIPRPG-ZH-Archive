import type { AppRuntime } from "@/app/.server/runtime";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { workReadCondition } from "@/app/.server/db/work-visibility";
import { parsePositiveId } from "@/app/.server/http/request";
import { HttpError } from "@/lib/http";
import { translate } from "@/lib/i18n/core";

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
     WHERE s.id=? AND s.external_endpoint IS NULL AND ${access.sql} LIMIT 1`,
  ).bind(spaceId, ...access.binds).first();
}

export async function saveNetplaySpace(runtime: AppRuntime, form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80) throw new HttpError(400, translate(runtime.uiLocale, "admin.netplay.invalidName"), undefined, "admin.netplay.invalidName");
  const provider = form.get("provider");
  let endpoint: string | null = null;
  if (provider === "external") {
    const raw = String(form.get("external_endpoint") ?? "").trim();
    const url = raw.length <= 2048 && URL.canParse(raw) ? new URL(raw) : null;
    if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new HttpError(400, translate(runtime.uiLocale, "admin.netplay.invalidEndpoint"), undefined, "admin.netplay.invalidEndpoint");
    }
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    endpoint = url.href;
  } else if (provider !== "cloudflare") {
    throw new HttpError(400, translate(runtime.uiLocale, "admin.netplay.invalidProvider"), undefined, "admin.netplay.invalidProvider");
  }
  const rawId = form.get("space_id");
  if (rawId === null) {
    await runtime.db.prepare("INSERT INTO netplay_spaces(name,external_endpoint) VALUES (?,?)")
      .bind(name, endpoint).run();
  } else {
    const id = parsePositiveId(String(rawId), undefined, undefined, undefined, "admin.netplay.invalidSpaceId");
    const result = await runtime.db.prepare("UPDATE netplay_spaces SET name=?,external_endpoint=? WHERE id=?")
      .bind(name, endpoint, id).run();
    if (!result.meta.changes) throw new HttpError(404, translate(runtime.uiLocale, "admin.netplay.notFound"), undefined, "admin.netplay.notFound");
  }
}

export async function setWorkNetplaySpace(runtime: AppRuntime, workId: number, spaceId: number | null) {
  if (spaceId !== null && !await runtime.db.prepare("SELECT 1 FROM netplay_spaces WHERE id=?").bind(spaceId).first()) {
    throw new HttpError(404, translate(runtime.uiLocale, "admin.netplay.notFound"), undefined, "admin.netplay.notFound");
  }
  const result = await runtime.db.prepare("UPDATE works SET netplay_space_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'deleted'")
    .bind(spaceId, workId).run();
  if (!result.meta.changes) throw new HttpError(404, translate(runtime.uiLocale, "admin.netplay.workNotFound"), undefined, "admin.netplay.workNotFound");
}
