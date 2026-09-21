import { scrypt } from "node:crypto";
import {
  base64UrlDecodeBytes,
  base64UrlEncodeBytes,
} from "@/app/.server/crypto/encoding";
import { timingSafeEqualString } from "@/app/.server/crypto/sha256";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/password-rules";
import passwordPolicy from "./password-policy.json";

const PASSWORD_HASH_VERSION = "scrypt";
// Workers caps native scrypt at N * r * p <= 2^20. This OWASP profile uses 32 MiB.
const MAX_SCRYPT_COST = 2 ** 20;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

export function validatePasswordStrength(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`密码长度至少需要 ${PASSWORD_MIN_LENGTH} 位`);
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位`);
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordStrength(password);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derivedKey = await derivePasswordKey(password, salt, passwordPolicy);

  return [
    PASSWORD_HASH_VERSION,
    String(passwordPolicy.N),
    String(passwordPolicy.r),
    String(passwordPolicy.p),
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

  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_VERSION) {
    return false;
  }

  const parameters = parseParameters(parts);

  if (!parameters) return false;

  if (!/^[A-Za-z0-9_-]{22}$/.test(parts[4])) return false;
  const expected = parts[5];
  if (!/^[A-Za-z0-9_-]{43}$/.test(expected)) return false;

  let actual: string;
  try {
    const salt = base64UrlDecodeBytes(parts[4]);
    if (salt.byteLength !== SALT_BYTES) return false;
    actual = base64UrlEncodeBytes(
      await derivePasswordKey(password, salt, parameters),
    );
  } catch {
    return false;
  }

  return timingSafeEqualString(actual, expected);
}

export function passwordHashNeedsUpgrade(passwordHash: string | null): boolean {
  if (!passwordHash) return false;
  const parts = passwordHash.split("$");
  const parameters = parseParameters(parts);
  return (
    parts[0] !== PASSWORD_HASH_VERSION ||
    !parameters ||
    parameters.N < passwordPolicy.N ||
    parameters.N * parameters.r * parameters.p <
      passwordPolicy.N * passwordPolicy.r * passwordPolicy.p
  );
}

function parseParameters(parts: string[]): typeof passwordPolicy | null {
  if (!parts.slice(1, 4).every((part) => /^[1-9]\d*$/.test(part))) return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (
    ![N, r, p].every(Number.isSafeInteger) ||
    N < 8192 ||
    N > 32768 ||
    (N & (N - 1)) !== 0 ||
    r !== 8 ||
    p < 1 ||
    N * r * p > MAX_SCRYPT_COST
  ) {
    return null;
  }
  return { N, r, p, maxmem: passwordPolicy.maxmem };
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  parameters: typeof passwordPolicy,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, DERIVED_KEY_BYTES, parameters, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
