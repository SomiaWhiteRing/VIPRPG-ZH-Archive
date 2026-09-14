import { getCloudflareEnv } from "@/lib/server/cloudflare/env";
import type { ForumRuntime } from "./runtime";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAppOrigin } from "@/lib/server/auth/config";
import type { ForumRequestRuntime } from "./request";

export function getForumRuntime(): ForumRuntime {
  const env = getCloudflareEnv();
  return { db: env.DB, bucket: env.ARCHIVE_BUCKET };
}

export function getForumRequestRuntime(): ForumRequestRuntime {
  return { ...getForumRuntime(), origin: getAppOrigin(), execution: getCloudflareContext().ctx };
}
