import { getCloudflareEnv } from "@/app/.server/cloudflare/env";
import type { AppRuntime } from "@/app/.server/runtime";

export async function assertAuthEmailRateLimit(
  runtime: AppRuntime,
  key: string,
): Promise<void> {
  let result: { success: boolean };
  try {
    result = await getCloudflareEnv(
      runtime,
    ).AUTH_EMAIL_RATE_LIMITER.limit({ key });
  } catch (error) {
    console.error("Authentication rate-limit service failed", error);
    throw new Error("认证限流服务不可用");
  }
  if (!result.success) throw new Error("操作过于频繁，请稍后再试");
}
