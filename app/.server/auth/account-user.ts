import { getCurrentUser } from "@/app/.server/auth/current-user";
import { redirectPage } from "@/app/.server/http/page-response";
import type { AppRuntime } from "@/app/.server/runtime";

export async function requireAccountUser(
  runtime: AppRuntime,
  nextPath: string,
) {
  const user = await getCurrentUser(runtime);
  if (!user) redirectPage(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

export function parseAccountPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
