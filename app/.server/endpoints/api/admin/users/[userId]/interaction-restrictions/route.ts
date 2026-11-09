import { requireUser } from "@/app/.server/auth/guards";
import { parseInteractionRestrictions } from "@/app/.server/db/interaction-restrictions";
import { setUserBlockSettings } from "@/app/.server/db/user-blocks";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json } from "@/lib/http";

export async function PUT(runtime: AppRuntime, request: Request, userId: string) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  const senderId = parsePositiveId(userId);
  if (senderId === auth.user.id) throw new HttpError(404, "用户不存在");
  const input = await readJsonObject(request, "屏蔽设置无效", { maximumBytes: 1024, requireJsonContentType: true });
  const kinds = parseInteractionRestrictions(input.kinds);
  await setUserBlockSettings(runtime, auth.user, senderId, {}, kinds);
  return json({ ok: true, kinds });
}
