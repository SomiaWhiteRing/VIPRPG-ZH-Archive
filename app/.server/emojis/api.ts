import { readJsonObject } from "@/app/.server/http/request";
import { json as jsonResponse, HttpError, jsonError } from "@/lib/http";
import { Hono } from "hono";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";

import {
  addEmojis,
  characterSheets,
  defaults,
  emojiCategories,
  hotEmojis,
  initializeLibrary,
  libraryData,
  createEmojiGroup,
  renameEmojiGroup,
  deleteEmojiGroup,
  reorderEmojiGroup,
  addEmojiGroupMemberships,
  editEmojiGroupMemberships,
  parseGroupId,
  parseGroupIds,
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
  jsonResponse(
    { ok: true, ...body },
    { headers: { "Cache-Control": "no-store" } },
  );
export async function emojiRequestBody(request: Request) {
  return readJsonObject(request, "请求格式无效。", {
    maximumBytes: 64 * 1024,
    invalidJsonMessage: "JSON 格式无效。",
  });
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
      let createdGroupId: number | undefined;
      switch (body.op) {
        case "initialize":
          await initializeLibrary(db, user.id);
          break;
        case "add":
          await addEmojis(db, user.id, parseCells(body.cells), parseGroupId(body.groupId));
          break;
        case "remove":
          await removeEmojis(db, user.id, parseIds(body.ids), parseGroupId(body.groupId));
          break;
        case "group.add": {
          const groupId = parseGroupId(body.groupId);
          if (groupId == null) throw new HttpError(400, "请选择要加入的分组。");
          await addEmojiGroupMemberships(db, user.id, parseIds(body.ids), groupId);
          break;
        }
        case "groups.update":
          await editEmojiGroupMemberships(db, user.id, parseIds(body.ids), parseGroupIds(body.includeGroupIds), parseGroupIds(body.excludeGroupIds));
          break;
        case "group.create":
          createdGroupId = await createEmojiGroup(db, user.id);
          break;
        case "group.rename":
          await renameEmojiGroup(db, user.id, parseIds([body.id])[0], body.name);
          break;
        case "group.delete":
          await deleteEmojiGroup(db, user.id, parseIds([body.id])[0]);
          break;
        case "group.reorder":
          await reorderEmojiGroup(db, user.id, parseIds([body.id])[0], body.beforeId === null ? null : parseIds([body.beforeId])[0]);
          break;
        case "reorder":
          await reorderEmoji(
            db,
            user.id,
            parseIds(body.ids === undefined ? [body.id] : body.ids),
            body.beforeId === null ? null : parseIds([body.beforeId])[0],
          );
          break;
        default:
          throw new HttpError(400, "未知表情操作。");
      }
      return emojiJson({ ...await libraryData(db, user.id), ...(createdGroupId === undefined ? {} : { createdGroupId }) });
    }
    const offset = Number(params.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new HttpError(400, "分页位置无效。");
    switch (params.get("op") ?? "library") {
      case "library":
        return emojiJson(await libraryData(db, user.id));
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
    if (String(error).includes("UNIQUE constraint failed: user_emoji_groups.user_id, user_emoji_groups.name"))
      return jsonError("分组名称重复", new HttpError(409, "这个分组名称已存在。"));
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
