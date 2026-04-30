import { getCloudflareEnv } from "@/lib/server/cloudflare/env";

export function getD1(): D1Database {
  return getCloudflareEnv().DB;
}
