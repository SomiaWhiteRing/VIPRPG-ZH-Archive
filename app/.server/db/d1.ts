import { getCloudflareEnv } from "@/app/.server/cloudflare/env";
import type { AppRuntime } from "@/app/.server/runtime";

export function getD1(runtime: AppRuntime): D1Database {
  return getCloudflareEnv(runtime).DB;
}
