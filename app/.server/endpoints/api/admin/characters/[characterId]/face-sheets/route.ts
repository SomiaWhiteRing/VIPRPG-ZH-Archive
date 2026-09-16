import { requirePermission } from "@/app/.server/auth/authorize";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import { registerAdminFaceSheetForCharacter } from "@/app/.server/db/character-portrait-library";
import type { AppRuntime } from "@/app/.server/runtime";
import {
  readCharacterFaceSheet,
  storeCharacterFaceSheets,
} from "@/app/.server/storage/character-portraits";
import { HttpError, json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    characterId: string;
  };
};

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requirePermission(
    runtime,
    request,
    "character.portrait.upload",
  );
  if ("response" in auth) return auth.response;

  try {
    const { characterId: rawCharacterId } = await context.params;
    const characterId = parseId(rawCharacterId);
    const formData = await request.formData();
    const file = readCharacterFaceSheet(formData.get("face_sheet"));
    const [stored] = await storeCharacterFaceSheets(runtime, [file]);
    if (!stored) throw new HttpError(500, "脸图素材表未能写入存储。");

    const sheet = await registerAdminFaceSheetForCharacter(runtime, {
      actorUserId: auth.user.id,
      characterId,
      fileName: file.name,
      height: stored.height,
      sha256: stored.sha256,
      width: stored.width,
    });
    await writeAuthAuditLog(runtime, {
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_character_face_sheet_upload",
      detail: {
        characterId,
        faceSheetId: sheet.id,
        sha256: sheet.blobSha256,
        width: sheet.width,
        height: sheet.height,
      },
    });
    return json({ ok: true, sheet }, { status: 201 });
  } catch (error) {
    return jsonError("角色脸图素材表上传失败", error);
  }
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, "角色 ID 不合法，请返回角色维护页重新进入。");
  }
  return id;
}
