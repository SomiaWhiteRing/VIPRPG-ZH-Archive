import { toArrayBuffer, utf8Encode } from "@/app/.server/crypto/encoding";
import { sha256Hex } from "@/app/.server/crypto/sha256";
export const SESSION_COOKIE_NAME = "viprpg_session";
export async function getSessionHashFromCookieHeader(
  cookieHeader: string | null,
): Promise<string | null> {
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!isSessionToken(token)) return null;
  return hashSessionToken(token);
}

export async function hashSessionToken(token: string): Promise<string> {
  return sha256Hex(toArrayBuffer(utf8Encode(token)));
}

export function parseCookie(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=") || null;
  }
  return null;
}

export function isSessionToken(token: string | null): token is string {
  return Boolean(token && /^[A-Za-z0-9_-]{43}$/.test(token));
}
