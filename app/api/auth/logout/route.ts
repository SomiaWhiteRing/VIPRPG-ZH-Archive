import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { createClearSessionCookie, revokeSessionFromCookieHeader } from "@/lib/server/auth/session";
import { assertSameOrigin, SameOriginError } from "@/lib/server/auth/origin";
import { redirectResponse } from "@/lib/server/http/form";
import { json } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (!(error instanceof SameOriginError)) throw error;
    return json({ ok: false, error: error.message }, { status: 403 });
  }
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const response = redirectResponse(new URL(nextPath, request.url));

  await revokeSessionFromCookieHeader(request.headers.get("cookie"));
  response.headers.append("Set-Cookie", createClearSessionCookie(request.url));

  return response;
}
