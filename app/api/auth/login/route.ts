import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { createSessionCookie } from "@/lib/server/auth/session";
import { assertSameOrigin } from "@/lib/server/auth/origin";
import { getRequestFingerprints } from "@/lib/server/auth/request-context";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { authenticateUser } from "@/lib/server/db/users";
import {
  readRequiredFormString,
  redirectResponse,
  redirectWithParams,
} from "@/lib/server/http/form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const email = formData.get("email");

  try {
    assertSameOrigin(request);
    const user = await authenticateUser({
      email: readRequiredFormString(formData, "email"),
      password: readRequiredFormString(formData, "password"),
    });
    const response = redirectResponse(new URL(nextPath, request.url));
    await writeAuthAuditLog({ userId: user.id, email: user.email, eventType: "login_succeeded", ...await getRequestFingerprints(request) });

    response.headers.append(
      "Set-Cookie",
      await createSessionCookie(user.id, request),
    );

    return response;
  } catch (error) {
    return redirectWithParams(request, "/login", {
      next: nextPath,
      email: typeof email === "string" ? email : null,
      error: error instanceof Error ? error.message : "登录失败",
    });
  }
}
