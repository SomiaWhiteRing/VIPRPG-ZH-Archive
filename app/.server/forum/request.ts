import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locale";
import { readJsonObject, readRequestBody } from "@/app/.server/http/request";
import { type PermissionKey, hasPermission } from "@/lib/authz/permissions";

import { HttpError } from "@/lib/http";
import { loadRequestSession } from "../auth/request-auth";
import { assertRequestOrigin, SameOriginError } from "../auth/request-origin";
import type { ForumRuntime } from "./runtime";

export type ForumRequestRuntime = ForumRuntime & {
  origin: string;
  execution: Pick<ExecutionContext, "waitUntil">;
};

export function assertForumOrigin(ctx: ForumRequestRuntime, request: Request) {
  try {
    assertRequestOrigin(request, ctx.origin);
  } catch (error) {
    if (error instanceof SameOriginError)
      throw new HttpError(403, error.message);
    throw error;
  }
}

export async function requireForumUser(
  ctx: ForumRequestRuntime,
  request: Request,
  permissions: readonly PermissionKey[] = ["forum.use"],
  locale: UiLocale = DEFAULT_UI_LOCALE,
) {
  assertForumOrigin(ctx, request);
  const auth = await loadRequestSession(ctx.db, request.headers.get("cookie"));
  if (!auth) throw new HttpError(401, translate(locale, "forum.write.login"));
  if (!permissions.some((key) => hasPermission(auth.user, key)))
    throw new HttpError(403, translate(locale, "admin.discussions.permissionDenied"));
  return auth;
}

export async function readForumBody(
  request: Request,
  maximum = 128 * 1024,
): Promise<ArrayBuffer> {
  return readRequestBody(request, maximum);
}

export async function readForumJson(
  request: Request,
  locale: UiLocale = DEFAULT_UI_LOCALE,
): Promise<Record<string, unknown>> {
  return readJsonObject(request, translate(locale, "forum.write.invalidRequest"), {
    maximumBytes: 128 * 1024,
    fatalUtf8: true,
    invalidJsonMessage: translate(locale, "forum.write.invalidRequest"),
  });
}
