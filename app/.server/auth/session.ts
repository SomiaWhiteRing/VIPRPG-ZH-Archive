import { base64UrlEncodeBytes } from "@/app/.server/crypto/encoding";
import type { AppRuntime } from "@/app/.server/runtime";
import {
  SESSION_COOKIE_NAME,
  hashSessionToken,
  isSessionToken,
  parseCookie,
} from "./session-token";
export {
  getSessionHashFromCookieHeader,
  hashSessionToken,
} from "./session-token";

import { getRequestFingerprints } from "@/app/.server/auth/request-context";
import { getD1 } from "@/app/.server/db/d1";

export { SESSION_COOKIE_NAME } from "./session-token";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export type SessionIdentity = { id: number; userId: number };

export async function createSessionCookie(
  runtime: AppRuntime,
  userId: number,
  request: Request,
): Promise<string> {
  const token = base64UrlEncodeBytes(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const sessionHash = await hashSessionToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000,
  ).toISOString();
  const fingerprints = await getRequestFingerprints(runtime, request);
  await getD1(runtime)
    .prepare(
      `
    INSERT INTO user_sessions (user_id, session_hash, expires_at, ip_hash, user_agent_hash)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .bind(
      userId,
      sessionHash,
      expiresAt,
      fingerprints.ipHash,
      fingerprints.userAgentHash,
    )
    .run();
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAge: SESSION_TTL_SECONDS,
    requestUrl: request.url,
  });
}

export function createClearSessionCookie(requestUrl: string): string {
  return serializeCookie(SESSION_COOKIE_NAME, "", { maxAge: 0, requestUrl });
}

export async function revokeSessionFromCookieHeader(
  runtime: AppRuntime,
  cookieHeader: string | null,
): Promise<void> {
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!isSessionToken(token)) return;
  await getD1(runtime)
    .prepare(
      `UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE session_hash = ?`,
    )
    .bind(await hashSessionToken(token))
    .run();
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; requestUrl: string },
): string {
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
