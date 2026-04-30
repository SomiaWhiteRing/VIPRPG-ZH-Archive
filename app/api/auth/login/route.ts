import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { createSessionCookie } from "@/lib/server/auth/session";
import { authenticateUser } from "@/lib/server/db/users";
import { readRequiredFormString, redirectWithParams } from "@/lib/server/http/form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const email = formData.get("email");

  try {
    const user = await authenticateUser({
      email: readRequiredFormString(formData, "email"),
      password: readRequiredFormString(formData, "password"),
    });
    const response = Response.redirect(new URL(nextPath, request.url), 303);

    response.headers.append(
      "Set-Cookie",
      await createSessionCookie(user.id, request.url),
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
