import { getCurrentUser } from "@/app/.server/auth/current-user";
import { getAuthSecret } from "@/app/.server/auth/config";
import { parseCookie, SESSION_COOKIE_NAME } from "@/app/.server/auth/session-token";
import { hashRequestFingerprint } from "@/app/.server/auth/tokens";
import { base64UrlDecodeBytes, base64UrlEncodeBytes, toArrayBuffer, utf8Encode } from "@/app/.server/crypto/encoding";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";

const COOKIE = "sea_guest";
const TTL_SECONDS = 30 * 24 * 60 * 60;
export type SeaActor = { key: string; userId: number | null; name: string; ipKey: string };

async function guestKey(runtime: AppRuntime) {
  return crypto.subtle.importKey("raw", toArrayBuffer(utf8Encode(getAuthSecret(runtime))), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function seaIpKey(runtime: AppRuntime) {
  const ip = runtime.request.headers.get("cf-connecting-ip");
  // The development Worker has no edge header. Forwarded headers are never trusted.
  if (!ip && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(runtime.origin).hostname))
    throw new HttpError(503, "暂时无法确认访问来源");
  return (await hashRequestFingerprint(runtime, `sea-ip:${ip ?? "local"}`))!;
}

export async function prepareSeaActor(runtime: AppRuntime): Promise<{ actor: SeaActor; cookie?: string }> {
  const user = await getCurrentUser(runtime);
  const ipKey = await seaIpKey(runtime);
  if (user) return { actor: { key: `user:${user.id}`, userId: user.id, name: user.displayName, ipKey } };
  // An expired, revoked or disabled login must not silently publish as a guest.
  if (parseCookie(runtime.request.headers.get("cookie"), SESSION_COOKIE_NAME))
    throw new HttpError(401, "登录状态已失效，请重新登录或退出登录后发言");
  const value = parseCookie(runtime.request.headers.get("cookie"), COOKIE);
  const key = await guestKey(runtime);
  if (value) {
    const match = /^([a-f0-9-]{36})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (match && Number(match[2]) > Date.now() && Number(match[2]) <= Date.now() + TTL_SECONDS * 1000) {
      const valid = await crypto.subtle.verify("HMAC", key, toArrayBuffer(base64UrlDecodeBytes(match[3])), toArrayBuffer(utf8Encode(`sea-guest-v1:${match[1]}.${match[2]}`)));
      if (valid) return { actor: { key: `guest:${match[1]}`, userId: null, name: "无名的VIPPER", ipKey } };
    }
  }
  const id = crypto.randomUUID();
  const payload = `${id}.${Date.now() + TTL_SECONDS * 1000}`;
  const signature = await crypto.subtle.sign("HMAC", key, toArrayBuffer(utf8Encode(`sea-guest-v1:${payload}`)));
  return {
    actor: { key: `guest:${id}`, userId: null, name: "无名的VIPPER", ipKey },
    cookie: `${COOKIE}=${payload}.${base64UrlEncodeBytes(new Uint8Array(signature))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}${new URL(runtime.request.url).protocol === "https:" ? "; Secure" : ""}`,
  };
}
