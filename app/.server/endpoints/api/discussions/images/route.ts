import { translate } from "@/lib/i18n/core";
import { getForumRequestRuntime } from "@/app/.server/forum/context";
import * as handler from "@/app/.server/forum/upload-handler";
import type { AppRuntime } from "@/app/.server/runtime";
import { jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    return await handler.POST(getForumRequestRuntime(runtime), request, runtime.uiLocale);
  } catch (error) {
    return jsonError(translate(runtime.uiLocale, "forum.write.requestFailed"), error);
  }
}
