import { getCloudflareEnv } from "@/lib/server/cloudflare/env";

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
  }
}
