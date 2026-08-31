import { getAuthContextFromRequest } from "@/lib/server/auth/current-user";
import { assertSameOrigin } from "@/lib/server/auth/origin";
import { updateOwnProfile } from "@/lib/server/db/users";
import { redirectWithParams } from "@/lib/server/http/form";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await getAuthContextFromRequest(request);
    if (!auth) return redirectWithParams(request, "/login", { next: "/me/profile" });
    const form = await request.formData();
    await updateOwnProfile({
      user: auth.user,
      displayName: String(form.get("displayName") ?? ""),
      bio: String(form.get("bio") ?? ""),
    });
    return redirectWithParams(request, "/me/profile", { profileUpdated: "1" });
  } catch (error) {
    return redirectWithParams(request, "/me/profile", { error: error instanceof Error ? error.message : "资料更新失败" });
  }
}
