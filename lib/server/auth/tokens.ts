import { getAuthSecret } from "@/lib/server/auth/config";
import {
  base64UrlEncodeBytes,
  toArrayBuffer,
  utf8Encode,
} from "@/lib/server/crypto/encoding";

export function generateVerificationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const value =
    ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];

  return String(value % 1_000_000).padStart(6, "0");
}

export async function hashVerificationCode(input: {
  email: string;
  purpose: string;
  code: string;
}): Promise<string> {
  return hmacSha256(
    ["verification-code", input.purpose, input.email, input.code].join(":"),
  );
}

export async function hashRequestFingerprint(value: string | null): Promise<string | null> {
  if (!value) {
    return null;
  }

  return hmacSha256(["request-fingerprint", value].join(":"));
}

async function hmacSha256(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8Encode(getAuthSecret())),
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
