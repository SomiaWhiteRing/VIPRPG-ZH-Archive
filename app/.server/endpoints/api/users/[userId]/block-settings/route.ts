import { requireUser } from "@/app/.server/auth/guards";
import { readUserBlockSettings, setUserBlockSettings } from "@/app/.server/db/user-blocks";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json } from "@/lib/http";
import { USER_BLOCK_OPTIONS, type UserBlockSettings } from "@/lib/user-blocks";

export async function GET(runtime: AppRuntime, request: Request, userId: string) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  const peerId = parsePositiveId(userId);
  if (peerId === auth.user.id) throw new HttpError(400, "不能屏蔽自己");
  if (!await runtime.db.prepare("SELECT 1 FROM users WHERE id=?").bind(peerId).first()) throw new HttpError(404, "用户不存在");
  return json({ ok: true, settings: await readUserBlockSettings(runtime, auth.user.id, peerId) });
}

export async function PUT(runtime: AppRuntime, request: Request, userId: string) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  const peerId = parsePositiveId(userId);
  const input = await readJsonObject(request, "屏蔽设置无效", { maximumBytes: 1024, requireJsonContentType: true });
  // Older clients submit the combined replies/mentions switch.
  if (!Object.hasOwn(input, "muteMentions")) input.muteMentions = input.muteReplies;
  if (Object.keys(input).length !== USER_BLOCK_OPTIONS.length || USER_BLOCK_OPTIONS.some(option => typeof input[option.key] !== "boolean"))
    throw new HttpError(400, "屏蔽设置无效");
  const settings = Object.fromEntries(USER_BLOCK_OPTIONS.map(option => [option.key, input[option.key]])) as UserBlockSettings;
  return json({ ok: true, settings: await setUserBlockSettings(runtime, auth.user, peerId, settings) });
}
