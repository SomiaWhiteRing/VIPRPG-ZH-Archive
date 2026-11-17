import { translate } from "@/lib/i18n/core";
import { requirePermission } from "@/app/.server/auth/authorize";
import { getD1 } from "@/app/.server/db/d1";
import { emojiJson, emojiRequestBody } from "@/app/.server/emojis/api";
import {
  defaults,
  parseCells,
  saveDefaults,
} from "@/app/.server/emojis/service";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, jsonError } from "@/lib/http";
export async function GET(runtime: AppRuntime, request: Request) {
  const auth = await requirePermission(
    runtime,
    request,
    "emoji.defaults.manage",
  );
  if ("response" in auth) return auth.response;
  return emojiJson({ emojis: await defaults(getD1(runtime)) });
}
export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requirePermission(
    runtime,
    request,
    "emoji.defaults.manage",
  );
  if ("response" in auth) return auth.response;
  try {
    const body = await emojiRequestBody(request, runtime.uiLocale);
    await saveDefaults(getD1(runtime), auth.user.id, parseCells(body.cells));
    return emojiJson({ emojis: await defaults(getD1(runtime)) });
  } catch (error) {
    return jsonError(translate(runtime.uiLocale, "emoji.error.defaultsFailed"),
      error instanceof HttpError && error.messageKey
        ? new HttpError(error.status, translate(runtime.uiLocale, error.messageKey, error.messageValues), error.code, error.messageKey, error.messageValues)
        : error);
  }
}
