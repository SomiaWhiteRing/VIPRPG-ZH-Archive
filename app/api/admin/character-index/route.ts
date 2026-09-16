import { hasPermission } from "@/lib/authz/permissions";
import { characterIndexPermission } from "@/lib/authz/character-permissions";
import { requireUser } from "@/lib/server/auth/guards";
import { readCharacterIndex, updateCharacterIndex } from "@/lib/server/db/character-index";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "分类编辑请求格式不正确");
    const permission = characterIndexPermission(body);
    if (!permission) throw new HttpError(400, "不支持的分类操作");
    if (!hasPermission(auth.user, permission)) return json({ ok: false, error: "Permission denied" }, { status: 403 });
    const result = await updateCharacterIndex(body);
    await writeAuthAuditLog({ userId: auth.user.id, email: auth.user.email, eventType: "admin_character_classification_update", detail: { operation: String(body.operation), categoryId: result.categoryId, characterId: result.characterId } });
    return json({ ok: true, ...result, data: await readCharacterIndex() });
  } catch (error) {
    if (error instanceof Error && /(?:CHECK|FOREIGN KEY|UNIQUE) constraint failed/i.test(error.message)) {
      return jsonError("角色分类保存失败", new HttpError(409, "分类或角色已发生变化，请刷新后重试"));
    }
    return jsonError("角色分类保存失败", error);
  }
}
