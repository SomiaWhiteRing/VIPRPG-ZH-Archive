import { Hono } from "hono";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, jsonError } from "@/lib/http";
import {
  addEmojis,
  characterSheets,
  defaults,
  emojiCategories,
  hotEmojis,
  initializeLibrary,
  library,
  parseCells,
  parseIds,
  readEmojis,
  removeEmojis,
  reorderEmoji,
  searchEmojiCharacters,
} from "./service";

export const emojiApi = new Hono<{
  Bindings: CloudflareEnv;
  Variables: { runtime: AppRuntime };
}>();
export const emojiJson = (body: object) =>
  Response.json(
    { ok: true, ...body },
    { headers: { "Cache-Control": "no-store" } },
  );
export async function emojiRequestBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "请求内容为空。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 64 * 1024) {
        await reader.cancel();
        throw new HttpError(413, "请求内容过大。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "JSON 格式无效。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "请求格式无效。");
  return value as Record<string, unknown>;
}
emojiApi.all("/api/emojis", async (c) => {
  if (c.req.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: { Allow: "GET, POST, OPTIONS" },
    });
  if (!["GET", "POST"].includes(c.req.method))
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, POST, OPTIONS" },
    });
  try {
    const runtime = c.get("runtime"),
      request = c.req.raw,
      db = getD1(runtime);
    const params = new URL(request.url).searchParams;
    if (request.method === "GET" && params.get("op") === "resolve") {
      return emojiJson({
        emojis: await readEmojis(db, parseIds(params.getAll("id").map(Number))),
      });
    }
    if (request.method === "POST") assertSameOrigin(runtime, request);
    const user = await getCurrentUser(runtime);
    if (!user) throw new HttpError(401, "请登录后使用表情库。");
    if (request.method === "POST") {
      const body = await emojiRequestBody(request);
      switch (body.op) {
        case "initialize":
          await initializeLibrary(db, user.id);
          break;
        case "replenish":
          await initializeLibrary(db, user.id, true);
          break;
        case "add":
          await addEmojis(db, user.id, parseCells(body.cells));
          break;
        case "remove":
          await removeEmojis(db, user.id, parseIds(body.ids));
          break;
        case "reorder":
          await reorderEmoji(
            db,
            user.id,
            parseIds([body.id])[0],
            body.beforeId === null ? null : parseIds([body.beforeId])[0],
          );
          break;
        default:
          throw new HttpError(400, "未知表情操作。");
      }
      return emojiJson({ emojis: await library(db, user.id) });
    }
    const offset = Number(params.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new HttpError(400, "分页位置无效。");
    switch (params.get("op") ?? "library") {
      case "library":
        return emojiJson({ emojis: await library(db, user.id) });
      case "defaults":
        return emojiJson({ emojis: await defaults(db) });
      case "hot":
        return emojiJson(await hotEmojis(db, offset));
      case "categories":
        return emojiJson({ items: await emojiCategories(db) });
      case "characters":
        return emojiJson(
          await searchEmojiCharacters(
            db,
            params.get("q") ?? "",
            offset,
            params.get("categoryId"),
          ),
        );
      case "sheets": {
        const id = Number(params.get("characterId"));
        if (!Number.isSafeInteger(id) || id < 1)
          throw new HttpError(400, "角色无效。");
        return emojiJson(
          await characterSheets(db, id, offset, params.get("focus") ?? ""),
        );
      }
      default:
        throw new HttpError(400, "未知表情查询。");
    }
  } catch (error) {
    if (error instanceof SameOriginError)
      return jsonError("请求来源无效", new HttpError(403, error.message));
    if (String(error).includes("face emoji unavailable"))
      return jsonError(
        "表情已不可用",
        new HttpError(409, "部分表情已不可用，请重新选择。"),
      );
    return jsonError("表情操作失败", error);
  }
});
