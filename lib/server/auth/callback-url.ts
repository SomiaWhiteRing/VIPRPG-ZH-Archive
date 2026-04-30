import { getAppOrigin } from "@/lib/server/auth/config";
import { applySearchParams } from "@/lib/server/http/form";

export function buildAuthCallbackUrl(
  path: "/register" | "/reset-password",
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(path, getAppOrigin());
  applySearchParams(url, params);
  return url.toString();
}
