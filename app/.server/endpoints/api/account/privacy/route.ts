import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { updateOwnProfileVisibility } from "@/app/.server/db/users";
import { redirectWithParams } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { accountPreferencesUpdateStatement } from "@/app/.server/db/account-preferences";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth)
      return redirectWithParams(request, "/login", { next: "/me/privacy" });
    const form = await request.formData();
    if (form.get("section") === "preferences") {
      await accountPreferencesUpdateStatement(runtime, auth.user.id, form).run();
      return redirectWithParams(request, "/me/privacy", { preferencesUpdated: "1" });
    }
    // Released friend forms include this hidden field; older forms preserve
    // the friend setting that their user never saw.
    const friendForm = form.has("notifyFriendAdditions");
    const combined = form.get("section") === "all";
    await updateOwnProfileVisibility(runtime, {
      user: auth.user,
      preferencesForm: combined ? form : undefined,
      notifyFriendAdditions: form.has("notifyFriendAdditions") ? form.getAll("notifyFriendAdditions").includes("1") : undefined,
      visibility: {
        bio: form.get("showBio") === "1",
        showcase: form.get("showShowcase") === "1",
        friends: form.has("showFriends") || friendForm ? form.getAll("showFriends").includes("1") : auth.user.profileVisibility.friends,
        favorites: form.get("showFavorites") === "1",
        history: form.get("showHistory") === "1",
        catalogs: form.get("showCatalogs") === "1",
        comments: form.get("showComments") === "1",
        discussions: form.get("showDiscussions") === "1",
      },
    });
    return redirectWithParams(request, "/me/privacy", combined ? { settingsUpdated: "1" } : { privacyUpdated: "1" });
  } catch (error) {
    return redirectWithParams(request, "/me/privacy", {
      error: error instanceof Error ? error.message : "隐私与偏好更新失败",
    });
  }
}
