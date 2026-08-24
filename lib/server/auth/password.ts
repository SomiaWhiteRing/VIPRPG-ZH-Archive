import { timingSafeEqualString } from "@/lib/server/crypto/sha256";
import {
  base64UrlDecodeBytes,
  base64UrlEncodeBytes,
  toArrayBuffer,
  utf8Encode,
} from "@/lib/server/crypto/encoding";

const PASSWORD_HASH_VERSION = "pbkdf2-sha256";
export const PASSWORD_HASH_ITERATIONS = 870_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

export function validatePasswordStrength(password: string): void {
  if (password.length < 12) {
    throw new Error("密码长度至少需要 12 位");
  }

  if (password.length > 256) {
    throw new Error("密码长度不能超过 256 位");
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

  if (!Number.isSafeInteger(iterations) || iterations < 10_000 || iterations > 2_000_000) {
    return false;
  }

  if (!/^[A-Za-z0-9_-]{22}$/.test(parts[2])) return false;
  const expected = parts[3];
  if (!/^[A-Za-z0-9_-]{43}$/.test(expected)) return false;

  let actual: string;
  try {
    const salt = base64UrlDecodeBytes(parts[2]);
    if (salt.byteLength !== SALT_BYTES) return false;
    actual = base64UrlEncodeBytes(await derivePasswordKey(password, salt, iterations));
  } catch {
    return false;
  }

  return timingSafeEqualString(actual, expected);
}

export function passwordHashNeedsUpgrade(passwordHash: string | null): boolean {
  if (!passwordHash) return false;
  const [version, rawIterations] = passwordHash.split("$", 2);
  const iterations = Number.parseInt(rawIterations ?? "", 10);
  return version !== PASSWORD_HASH_VERSION || !Number.isSafeInteger(iterations) || iterations < PASSWORD_HASH_ITERATIONS;
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
