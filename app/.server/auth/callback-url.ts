import { getAppOrigin } from "@/app/.server/auth/config";
import { applySearchParams } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export function buildAuthCallbackUrl(
  runtime: AppRuntime,
  path: "/register" | "/reset-password" | "/me/profile" | "/me/profile/email",
  params: Record<string, string | null | undefined>,
  code: string,
): string {
  const url = new URL(path, getAppOrigin(runtime));
  applySearchParams(url, params);
  // Fragments are not sent to the server or included in Referer headers.
  url.hash = new URLSearchParams({ code }).toString();
  return url.toString();
}
