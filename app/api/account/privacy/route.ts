import { getAuthContextFromRequest } from "@/lib/server/auth/current-user";
import { assertSameOrigin } from "@/lib/server/auth/origin";
import { updateOwnProfileVisibility } from "@/lib/server/db/users";
import { redirectWithParams } from "@/lib/server/http/form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await getAuthContextFromRequest(request);
    if (!auth) return redirectWithParams(request, "/login", { next: "/me/privacy" });
    const form = await request.formData();
    await updateOwnProfileVisibility({
      user: auth.user,
      visibility: {
        bio: form.get("showBio") === "1",
        favorites: form.get("showFavorites") === "1",
        history: form.get("showHistory") === "1",
        catalogs: form.get("showCatalogs") === "1",
        comments: form.get("showComments") === "1",
      },
    });
    return redirectWithParams(request, "/me/privacy", { privacyUpdated: "1" });
  } catch (error) {
    return redirectWithParams(request, "/me/privacy", {
      error: error instanceof Error ? error.message : "隐私设置更新失败",
    });
  }
}
