import { getAppOrigin } from "@/lib/server/auth/config";
import { applySearchParams } from "@/lib/server/http/form";

export function buildAuthCallbackUrl(
  path: "/register" | "/reset-password" | "/me/profile" | "/me/profile/email",
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(path, getAppOrigin());
  applySearchParams(url, params);
  return url.toString();
}
