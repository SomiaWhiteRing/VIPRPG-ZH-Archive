import { assertAuthSourceRateLimit } from "@/app/.server/auth/rate-limit";
import { hashSessionToken, isSessionToken } from "@/app/.server/auth/session-token";
import { getArchiveNetplayEndpoint, getPublishedArchiveDownloadRecord } from "@/app/.server/db/archive-downloads";
import { readNetplayReplayResponse } from "@/app/.server/endpoints/api/account/netplay-replays/route";
import { POST as uploadNetplayRecording } from "@/app/.server/endpoints/api/netplay-recordings/upload/route";
import { readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { toyNetplayOrigin } from "@/lib/archive/netplay-ingress";
import { json, jsonError } from "@/lib/http";

export async function handleToyGyokuroNetplay(runtime: AppRuntime, request: Request, upload = false) {
  const workId = Number(runtime.env.TOY_NETPLAY_WORK_ID);
  if (!Number.isSafeInteger(workId) || workId <= 0 || !runtime.env.NETPLAY_HK_IDENTITY_KEY) {
    return new Response(null, { status: 404 });
  }
  if (request.headers.get("Origin") !== toyNetplayOrigin) return new Response(null, { status: 403 });
  const headers = {
    "Access-Control-Allow-Origin": toyNetplayOrigin,
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      ...headers,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": upload ? "Content-Type, X-Netplay-Recording-Grant" : "Content-Type, Authorization",
    } });
  }

  let response: Response;
  try {
    response = upload ? await uploadNetplayRecording(runtime, request) : await handleToyRequest(runtime, request, workId);
  } catch (error) {
    response = jsonError("请求失败", error);
  }
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

async function handleToyRequest(runtime: AppRuntime, request: Request, workId: number) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? null;
  if (!isSessionToken(token)) return new Response(null, { status: 401 });
  // The credential belongs to this game. It is stored in Bilibili's per-player cloud storage.
  const externalId = `toy-gyokuro:${await hashSessionToken(token)}`;
  const input = await readJsonObject(request, "Invalid Toy netplay request", { maximumBytes: 2048 });
  const playerQuery = runtime.db.prepare("SELECT id, display_name AS displayName, status FROM users WHERE external_auth_id = ?")
    .bind(externalId);
  let player = await playerQuery.first<{ id: number; displayName: string; status: string }>();
  if (input.operation !== "session") {
    if (player?.status !== "active") return new Response(null, { status: 401 });
    return readNetplayReplayResponse(runtime, { ...input, workId }, player.id);
  }

  const current = await runtime.db.prepare(
    "SELECT id FROM archive_versions WHERE work_id = ? AND is_current = 1 AND status = 'published' AND purged_at IS NULL",
  ).bind(workId).first<{ id: number }>();
  const record = current ? await getPublishedArchiveDownloadRecord(runtime, current.id, true) : null;
  if (!record?.netplayCapable || !record.netplayExternalEndpoint) return new Response(null, { status: 404 });
  if (input.archiveVersionId !== record.id) return new Response(null, { status: 409 });
  if (!player) {
    await assertAuthSourceRateLimit(runtime, "gyokuro-toy-register");
    const displayName = `B站玩家 ${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await runtime.db.prepare("INSERT INTO users (external_auth_id, display_name, status) VALUES (?, ?, 'active') ON CONFLICT(external_auth_id) DO NOTHING")
      .bind(externalId, displayName).run();
    player = await playerQuery.first<{ id: number; displayName: string; status: string }>();
  }
  if (player?.status !== "active") return new Response(null, { status: 401 });
  const netplayEndpoint = await getArchiveNetplayEndpoint(runtime, record, true, player);
  if (!netplayEndpoint?.includes("/identity/")) return new Response(null, { status: 503 });
  return json({ workId, netplayEndpoint });
}
