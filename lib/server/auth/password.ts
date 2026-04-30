import { timingSafeEqualString } from "@/lib/server/crypto/sha256";
import {
  base64UrlDecodeBytes,
  base64UrlEncodeBytes,
  toArrayBuffer,
  utf8Encode,
} from "@/lib/server/crypto/encoding";

const PASSWORD_HASH_VERSION = "pbkdf2-sha256";
const PASSWORD_HASH_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

export function validatePasswordStrength(password: string): void {
  if (password.length < 10) {
    throw new Error("密码长度至少需要 10 位");
  }

  if (password.length > 256) {
    throw new Error("密码长度不能超过 256 位");
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("密码至少需要同时包含字母和数字");
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordStrength(password);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derivedKey = await derivePasswordKey(password, salt, PASSWORD_HASH_ITERATIONS);

  return [
    PASSWORD_HASH_VERSION,
    String(PASSWORD_HASH_ITERATIONS),
    base64UrlEncodeBytes(salt),
    base64UrlEncodeBytes(derivedKey),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  if (!passwordHash) {
    await hashPassword("dummy-password-123");
    return false;
  }

  const parts = passwordHash.split("$");

  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_VERSION) {
    return false;
  }

  const iterations = Number.parseInt(parts[1], 10);

  if (!Number.isSafeInteger(iterations) || iterations < 10_000) {
    return false;
  }

  const salt = base64UrlDecodeBytes(parts[2]);
  const expected = parts[3];
  const actual = base64UrlEncodeBytes(
    await derivePasswordKey(password, salt, iterations),
  );

  return timingSafeEqualString(actual, expected);
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8Encode(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    keyMaterial,
    DERIVED_KEY_BITS,
  );

  return new Uint8Array(bits);
}
