import { getCloudflareEnv } from "@/lib/server/cloudflare/env";
import { getAppOrigin, isTurnstileEnabled } from "@/lib/server/auth/config";

export async function assertAuthEmailRateLimit(key: string): Promise<void> {
  try {
    const result = await getCloudflareEnv().AUTH_EMAIL_RATE_LIMITER.limit({ key });

    if (!result.success) {
      throw new Error("操作过于频繁，请稍后再试");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("操作过于频繁")) {
      throw error;
    }
    const hostname = new URL(getAppOrigin()).hostname;
    const explicitlyDisabledLocally = !isTurnstileEnabled() &&
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]");
    if (!explicitlyDisabledLocally) throw new Error("认证限流服务不可用");
  }
}
