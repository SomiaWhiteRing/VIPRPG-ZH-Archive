import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import {
  createClearSessionCookie,
  revokeSessionFromCookieHeader,
} from "@/app/.server/auth/session";
import { redirectResponse } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { json } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
  } catch (error) {
    if (!(error instanceof SameOriginError)) throw error;
    return json({ ok: false, error: error.message }, { status: 403 });
  }
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const response = redirectResponse(new URL(nextPath, request.url));

  await revokeSessionFromCookieHeader(runtime, request.headers.get("cookie"));
  response.headers.append("Set-Cookie", createClearSessionCookie(request.url));

  return response;
}
