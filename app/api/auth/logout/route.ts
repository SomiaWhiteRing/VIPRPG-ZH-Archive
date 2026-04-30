import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { createClearSessionCookie } from "@/lib/server/auth/session";
import { redirectResponse } from "@/lib/server/http/form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const response = redirectResponse(new URL(nextPath, request.url));

  response.headers.append("Set-Cookie", createClearSessionCookie(request.url));

  return response;
}
