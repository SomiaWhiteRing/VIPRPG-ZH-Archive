import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { updateOwnProfileVisibility } from "@/app/.server/db/users";
import { redirectWithParams } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth)
      return redirectWithParams(request, "/login", { next: "/me/privacy" });
    const form = await request.formData();
    await updateOwnProfileVisibility(runtime, {
      user: auth.user,
      visibility: {
        bio: form.get("showBio") === "1",
        showcase: form.get("showShowcase") === "1",
        favorites: form.get("showFavorites") === "1",
        history: form.get("showHistory") === "1",
        catalogs: form.get("showCatalogs") === "1",
        comments: form.get("showComments") === "1",
        discussions: form.get("showDiscussions") === "1",
      },
    });
    return redirectWithParams(request, "/me/privacy", { privacyUpdated: "1" });
  } catch (error) {
    return redirectWithParams(request, "/me/privacy", {
      error: error instanceof Error ? error.message : "隐私设置更新失败",
    });
  }
}
