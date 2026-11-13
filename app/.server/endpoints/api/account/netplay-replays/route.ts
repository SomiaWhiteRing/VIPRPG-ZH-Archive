import { getCurrentUser } from "@/app/.server/auth/current-user";
import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { getNetplayReplay, listNetplayReplays, readNetplayReplay, setNetplayReplayFavorite } from "@/app/.server/db/netplay-replays";
import { workReadCondition } from "@/app/.server/db/work-visibility";
import { readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { isAdministrator } from "@/lib/authz/roles";
import { json } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  try { assertSameOrigin(runtime, request); }
  catch (error) {
    if (!(error instanceof SameOriginError)) throw error;
    return new Response(null, { status: 403 });
  }
  const user = await getCurrentUser(runtime);
  if (!user) return new Response(null, { status: 401 });
  const { workId, operation, page, favorites, id, favorite } = await readJsonObject(
    request, "Invalid replay request", { maximumBytes: 2048 },
  );
  if (typeof workId !== "number" || !Number.isSafeInteger(workId) || workId < 1) return new Response(null, { status: 400 });
  const access = workReadCondition(user);
  const row = await runtime.db.prepare(`SELECT w.netplay_space_id FROM works w
    WHERE w.id=? AND w.netplay_space_id IS NOT NULL AND ${access.sql}`)
    .bind(workId, ...access.binds).first<{ netplay_space_id: number }>();
  if (!row) return new Response(null, { status: 404 });
  const space = isAdministrator(user) ? null : row.netplay_space_id;
  if (operation === "available") return json({ available: true });
  if (operation === "list") {
    if (typeof page !== "number" || !Number.isInteger(page) || page < 0 || page > 100000) return new Response(null, { status: 400 });
    return json(await listNetplayReplays(runtime, user.id, space, page, favorites === true));
  }
  if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) return new Response(null, { status: 400 });
  const replay = await getNetplayReplay(runtime, user.id, space, id);
  if (!replay) return new Response(null, { status: 404 });
  if (operation === "favorite" && typeof favorite === "boolean") {
    await setNetplayReplayFavorite(runtime, user.id, id, favorite);
    return json({ favorite });
  }
  if (operation !== "detail" && operation !== "frames") return new Response(null, { status: 400 });
  const data = await readNetplayReplay(runtime, id, replay.terminal, operation === "frames");
  if (!data) return new Response(null, { status: 404 });
  return json({ ...replay, ...data });
}
