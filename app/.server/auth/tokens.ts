import { getAuthSecret } from "@/app/.server/auth/config";
import {
  base64UrlEncodeBytes,
  toArrayBuffer,
  utf8Encode,
} from "@/app/.server/crypto/encoding";
import type { AppRuntime } from "@/app/.server/runtime";

export function generateVerificationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const value =
    ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];

  return String(value % 1_000_000).padStart(6, "0");
}

export async function hashVerificationCode(
  runtime: AppRuntime,
  input: {
    userId?: number | null;
    email: string;
    purpose: string;
    code: string;
  },
): Promise<string> {
  return hmacSha256(
    runtime,
    [
      "verification-code",
      String(input.userId ?? ""),
      input.purpose,
      input.email,
      input.code,
    ].join(":"),
  );
}

export async function hashRequestFingerprint(
  runtime: AppRuntime,
  value: string | null,
): Promise<string | null> {
  if (!value) {
    return null;
  }

  return hmacSha256(runtime, ["request-fingerprint", value].join(":"));
}

async function hmacSha256(runtime: AppRuntime, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8Encode(getAuthSecret(runtime))),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(utf8Encode(value)),
  );

  return base64UrlEncodeBytes(new Uint8Array(signature));
}
