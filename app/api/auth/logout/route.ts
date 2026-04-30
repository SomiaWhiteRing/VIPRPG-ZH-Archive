import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { createClearSessionCookie } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const response = Response.redirect(new URL(nextPath, request.url), 303);

  response.headers.append("Set-Cookie", createClearSessionCookie(request.url));

  return response;
}
