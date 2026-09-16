import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { updateOwnProfile } from "@/app/.server/db/users";
import { redirectWithParams } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth)
      return redirectWithParams(request, "/login", { next: "/me/profile" });
    const form = await request.formData();
    await updateOwnProfile(runtime, {
      user: auth.user,
      displayName: String(form.get("displayName") ?? ""),
      bio: String(form.get("bio") ?? ""),
    });
    return redirectWithParams(request, "/me/profile", { profileUpdated: "1" });
  } catch (error) {
    return redirectWithParams(request, "/me/profile", {
      error: error instanceof Error ? error.message : "资料更新失败",
    });
  }
}
