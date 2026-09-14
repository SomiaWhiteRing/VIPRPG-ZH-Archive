import { loadRequestSession } from "../auth/request-auth";
import { hasPermission, type PermissionKey } from "@/lib/authz/permissions";
import { HttpError } from "../http/json";
import type { ForumRuntime } from "./runtime";
import { assertRequestOrigin, SameOriginError } from "../auth/request-origin";

export type ForumRequestRuntime = ForumRuntime & { origin: string; execution: ExecutionContext };

export function assertForumOrigin(ctx: ForumRequestRuntime, request: Request) {
  try{assertRequestOrigin(request,ctx.origin);}
  catch(error){if(error instanceof SameOriginError)throw new HttpError(403,error.message);throw error;}
}

export async function requireForumUser(ctx: ForumRequestRuntime, request: Request, permissions?: readonly PermissionKey[]) {
  assertForumOrigin(ctx, request);
  const auth = await loadRequestSession(ctx.db, request.headers.get("cookie"));
  if (!auth) throw new HttpError(401, "请登录后继续。");
  if (permissions && !permissions.some((key) => hasPermission(auth.user, key))) throw new HttpError(403, "没有此操作权限。");
  return auth;
}

export async function readForumBody(request: Request, maximum = 128 * 1024): Promise<ArrayBuffer> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new HttpError(413, "请求过大。");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "请求为空。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new HttpError(413, "请求过大。"); }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body.buffer;
}

export async function readForumJson(request: Request): Promise<Record<string, unknown>> {
  const bytes = await readForumBody(request);
  try {
    const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  } catch { /* Return the same public error for all invalid JSON. */ }
  throw new HttpError(400, "请求无效。");
}
