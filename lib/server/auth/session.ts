import { base64UrlEncodeBytes, toArrayBuffer, utf8Encode } from "@/lib/server/crypto/encoding";
import { sha256Hex } from "@/lib/server/crypto/sha256";
import { getRequestFingerprints } from "@/lib/server/auth/request-context";
import { getD1 } from "@/lib/server/db/d1";

export const SESSION_COOKIE_NAME = "viprpg_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export type SessionIdentity = { id: number; userId: number };

export async function createSessionCookie(userId: number, request: Request): Promise<string> {
  const token = base64UrlEncodeBytes(crypto.getRandomValues(new Uint8Array(32)));
  const sessionHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const fingerprints = await getRequestFingerprints(request);
  await getD1().prepare(`
    INSERT INTO user_sessions (user_id, session_hash, expires_at, last_seen_at, ip_hash, user_agent_hash)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
  `).bind(userId, sessionHash, expiresAt, fingerprints.ipHash, fingerprints.userAgentHash).run();
  return serializeCookie(SESSION_COOKIE_NAME, token, { maxAge: SESSION_TTL_SECONDS, requestUrl: request.url });
}

export function createClearSessionCookie(requestUrl: string): string {
  return serializeCookie(SESSION_COOKIE_NAME, "", { maxAge: 0, requestUrl });
}

export async function readSessionFromCookieHeader(cookieHeader: string | null): Promise<SessionIdentity | null> {
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!isSessionToken(token)) return null;
  const row = await getD1().prepare(`
    SELECT id, user_id FROM user_sessions
    WHERE session_hash = ? AND revoked_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(await hashSessionToken(token)).first<{ id: number; user_id: number }>();
  if (!row) return null;
  await getD1().prepare(`
    UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-1 day'))
  `).bind(row.id).run();
  return { id: row.id, userId: row.user_id };
}

export async function revokeSessionFromCookieHeader(cookieHeader: string | null): Promise<void> {
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!isSessionToken(token)) return;
  await getD1().prepare(`UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE session_hash = ?`)
    .bind(await hashSessionToken(token)).run();
}

export async function revokeAllUserSessions(userId: number): Promise<void> {
  await getD1().prepare(`UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = ? AND revoked_at IS NULL`)
    .bind(userId).run();
}

export async function hashSessionToken(token: string): Promise<string> {
  return sha256Hex(toArrayBuffer(utf8Encode(token)));
}

function serializeCookie(name: string, value: string, options: { maxAge: number; requestUrl: string }): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
  ];
  if (new URL(options.requestUrl).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=") || null;
  }
  return null;
}

function isSessionToken(token: string | null): token is string {
  return Boolean(token && /^[A-Za-z0-9_-]{43}$/.test(token));
}
