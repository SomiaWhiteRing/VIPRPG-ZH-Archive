import { requireUser } from "@/app/.server/auth/guards";
import { parseInteractionRestrictions, readInteractionRestrictions } from "@/app/.server/db/interaction-restrictions";
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
  const [settings, interactionRestrictions] = await Promise.all([
    readUserBlockSettings(runtime, auth.user.id, peerId),
    readInteractionRestrictions(runtime.db, auth.user.id, peerId),
  ]);
  return json({ ok: true, settings, interactionRestrictions });
}

export async function PUT(runtime: AppRuntime, request: Request, userId: string) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  const peerId = parsePositiveId(userId);
  const { interactionRestrictions: rawRestrictions, ...input } = await readJsonObject(request, "屏蔽设置无效", { maximumBytes: 1024, requireJsonContentType: true });
  const restrictions = rawRestrictions === undefined ? undefined : parseInteractionRestrictions(rawRestrictions);
  if (restrictions && Object.keys(input).length === 0)
    return json({ ok: true, settings: await setUserBlockSettings(runtime, auth.user, peerId, {}, restrictions) });
  // Older clients submit the combined replies/mentions switch.
  if (!Object.hasOwn(input, "muteMentions")) input.muteMentions = input.muteReplies;
  // Older clients leave the display setting untouched.
  const options = USER_BLOCK_OPTIONS.filter(option => option.key !== "hidePosts" || Object.hasOwn(input, option.key));
  if (Object.keys(input).length !== options.length || options.some(option => typeof input[option.key] !== "boolean"))
    throw new HttpError(400, "屏蔽设置无效");
  const settings = Object.fromEntries(options.map(option => [option.key, input[option.key]])) as Partial<UserBlockSettings>;
  return json({ ok: true, settings: await setUserBlockSettings(runtime, auth.user, peerId, settings, restrictions) });
}
