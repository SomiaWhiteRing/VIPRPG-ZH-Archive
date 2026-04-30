import { timingSafeEqualString } from "@/lib/server/crypto/sha256";
import { getAuthSecret } from "@/lib/server/auth/config";
import {
  base64UrlDecodeString,
  base64UrlEncodeBytes,
  base64UrlEncodeString,
  toArrayBuffer,
  utf8Encode,
} from "@/lib/server/crypto/encoding";

export const SESSION_COOKIE_NAME = "viprpg_session";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

type SessionPayload = {
  v: 1;
  uid: number;
  exp: number;
};

export async function createSessionCookie(
  userId: number,
  requestUrl: string,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload: SessionPayload = {
    v: 1,
    uid: userId,
    exp: expiresAt,
  };
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await sign(encodedPayload);
  const token = `${encodedPayload}.${signature}`;

  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAge: SESSION_TTL_SECONDS,
    requestUrl,
  });
}

export function createClearSessionCookie(requestUrl: string): string {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    maxAge: 0,
    requestUrl,
  });
}

export async function readSessionUserIdFromCookieHeader(
  cookieHeader: string | null,
): Promise<number | null> {
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);

  if (!token) {
    return null;
  }

  return readSessionUserIdFromToken(token);
}

export async function readSessionUserIdFromToken(token: string): Promise<number | null> {
  const tokenParts = token.split(".");

  if (tokenParts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = tokenParts;

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await sign(encodedPayload);

  if (!timingSafeEqualString(signature, expectedSignature)) {
    return null;
  }

  let payload: SessionPayload;

  try {
    payload = JSON.parse(base64UrlDecodeString(encodedPayload)) as SessionPayload;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    payload.v !== 1 ||
    !Number.isSafeInteger(payload.uid) ||
    payload.uid <= 0 ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= now
  ) {
    return null;
  }

  return payload.uid;
}

async function sign(value: string): Promise<string> {
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

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge: number;
    requestUrl: string;
  },
): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
  ];

  if (new URL(options.requestUrl).protocol === "https:") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");

    if (rawName === name) {
      return rawValue.join("=") || null;
    }
  }

  return null;
}
