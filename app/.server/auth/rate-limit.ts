import { getCloudflareEnv } from "@/app/.server/cloudflare/env";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";
import { hashRequestFingerprint } from "./tokens";

export async function assertAuthSourceRateLimit(runtime: AppRuntime, purpose: string): Promise<void> {
  // Only the edge-provided address is trusted; forwarded headers are caller-controlled.
  const source = await hashRequestFingerprint(runtime, runtime.request.headers.get("cf-connecting-ip"));
  await assertAuthEmailRateLimit(runtime, `${purpose}:source:${source ?? "unknown"}`);
}

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
  if (!result.success) throw new HttpError(429, "操作过于频繁，请稍后再试");
}
