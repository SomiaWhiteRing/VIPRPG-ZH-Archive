import { assertSameOrigin } from "@/app/.server/auth/origin";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { getRequestFingerprints } from "@/app/.server/auth/request-context";
import { createSessionCookie } from "@/app/.server/auth/session";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import { authenticateUser } from "@/app/.server/db/users";
import {
  readRequiredFormString,
  redirectResponse,
  redirectWithParams,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const email = formData.get("email");

  try {
    assertSameOrigin(runtime, request);
    const user = await authenticateUser(runtime, {
      email: readRequiredFormString(formData, "email"),
      password: readRequiredFormString(formData, "password"),
    });
    const response = redirectResponse(new URL(nextPath, request.url));
    await writeAuthAuditLog(runtime, {
      userId: user.id,
      email: user.email,
      eventType: "login_succeeded",
      ...(await getRequestFingerprints(runtime, request)),
    });

    response.headers.append(
      "Set-Cookie",
      await createSessionCookie(runtime, user.id, request),
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
