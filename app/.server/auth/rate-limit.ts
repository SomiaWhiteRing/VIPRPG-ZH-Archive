import { getAppOrigin } from "@/app/.server/auth/config";
import { getCloudflareEnv } from "@/app/.server/cloudflare/env";
import type { AppRuntime } from "@/app/.server/runtime";

export async function assertAuthEmailRateLimit(
  runtime: AppRuntime,
  key: string,
): Promise<void> {
  try {
    const result = await getCloudflareEnv(
      runtime,
    ).AUTH_EMAIL_RATE_LIMITER.limit({ key });

    if (!result.success) {
      throw new Error("操作过于频繁，请稍后再试");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("操作过于频繁")) {
      throw error;
    }
    const hostname = new URL(getAppOrigin(runtime)).hostname;
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";
    if (!isLocalhost) throw new Error("认证限流服务不可用");
  }
}
