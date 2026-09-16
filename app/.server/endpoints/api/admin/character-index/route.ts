import { requireUser } from "@/app/.server/auth/guards";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import {
  readCharacterIndex,
  updateCharacterIndex,
} from "@/app/.server/db/character-index";
import { readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { characterIndexPermission } from "@/lib/authz/character-permissions";
import { hasPermission } from "@/lib/authz/permissions";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "分类编辑请求格式不正确");
    const permission = characterIndexPermission(body);
    if (!permission) throw new HttpError(400, "不支持的分类操作");
    if (!hasPermission(auth.user, permission))
      return json({ ok: false, error: "Permission denied" }, { status: 403 });
    const result = await updateCharacterIndex(runtime, body);
    await writeAuthAuditLog(runtime, {
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_character_classification_update",
      detail: {
        operation: String(body.operation),
        categoryId: result.categoryId,
        characterId: result.characterId,
      },
    });
    return json({
      ok: true,
      ...result,
      data: await readCharacterIndex(runtime),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /(?:CHECK|FOREIGN KEY|UNIQUE) constraint failed/i.test(error.message)
    ) {
      return jsonError(
        "角色分类保存失败",
        new HttpError(409, "分类或角色已发生变化，请刷新后重试"),
      );
    }
    return jsonError("角色分类保存失败", error);
  }
}
