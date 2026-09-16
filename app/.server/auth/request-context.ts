import { hashRequestFingerprint } from "@/app/.server/auth/tokens";
import type { AppRuntime } from "@/app/.server/runtime";

export async function getRequestFingerprints(
  runtime: AppRuntime,
  request: Request,
): Promise<{
  ipHash: string | null;
  userAgentHash: string | null;
}> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const userAgent = request.headers.get("user-agent");

  return {
    ipHash: await hashRequestFingerprint(runtime, ip),
    userAgentHash: await hashRequestFingerprint(runtime, userAgent),
  };
}
