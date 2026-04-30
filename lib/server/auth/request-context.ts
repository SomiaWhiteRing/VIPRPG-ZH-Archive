import { hashRequestFingerprint } from "@/lib/server/auth/tokens";

export async function getRequestFingerprints(request: Request): Promise<{
  ipHash: string | null;
  userAgentHash: string | null;
}> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const userAgent = request.headers.get("user-agent");

  return {
    ipHash: await hashRequestFingerprint(ip),
    userAgentHash: await hashRequestFingerprint(userAgent),
  };
}
