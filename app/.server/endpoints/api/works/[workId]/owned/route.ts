import { requirePermission } from "@/app/.server/auth/authorize";
import { parseCharacterSelectionsJson } from "@/app/.server/db/characters";
import {
  getWorkTranslators,
  parseExtraStaffJson,
  parseTranslatorSelectionsJson,
} from "@/app/.server/db/creators";
import {
  getOwnedWorkForEdit,
  updateOwnedWork,
} from "@/app/.server/db/game-library";
import { parseWorkMoreInfoJson } from "@/app/.server/http/work-more-info";
import type { AppRuntime } from "@/app/.server/runtime";
import {
  ensureCharacterFaceSheets,
  readCharacterFaceSheet,
  storeCharacterFaceSheets,
} from "@/app/.server/storage/character-portraits";
import {
  readWorkImage,
  storeWorkImages,
} from "@/app/.server/storage/work-images";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  const auth = await requirePermission(runtime, request, "work.update_own");
  if ("response" in auth) return auth.response;

  try {
    const { workId: rawWorkId } = await context.params;
    const workId = parseWorkId(rawWorkId);
    const current = await getOwnedWorkForEdit(runtime, workId, auth.user);
    if (!current) throw new HttpError(404, "作品不存在或不属于当前上传者");
    const form = await request.formData();
    const metadata = parseMetadata(form);
    const characterFaceSheets = form
      .getAll("character_face_sheets[]")
      .filter((value): value is File => value instanceof File && value.size > 0)
      .map((value) => readCharacterFaceSheet(value));
    const imageEntries = form
      .getAll("images[]")
      .filter(
        (value): value is File => value instanceof File && value.size > 0,
      );
    const previewBlobSha256s = imageEntries.length
      ? await storeWorkImages(
          runtime,
          imageEntries.map((value) => readWorkImage(value, "images[]")),
        )
      : current.media
          .filter((media) => media.kind === "preview")
          .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
          .map((media) => media.blobSha256);
    await storeCharacterFaceSheets(runtime, characterFaceSheets);
    await ensureCharacterFaceSheets(
      runtime,
      metadata.characters.flatMap((credit) => [
        ...credit.faceSheetBlobSha256s,
        ...(credit.portrait ? [credit.portrait.blobSha256] : []),
      ]),
      auth.user.id,
    );
    await updateOwnedWork(
      runtime,
      {
        user: auth.user,
        workId,
        ...metadata,
        previewBlobSha256s,
      },
      current,
    );
    return json({
      ok: true,
      translators: await getWorkTranslators(runtime, workId),
    });
  } catch (error) {
    return jsonError("作品资料保存失败", error);
  }
}

function parseMetadata(form: FormData) {
  const status = readRequiredString(form.get("status"), "status");
  if (status !== "published" && status !== "hidden") {
    throw new HttpError(400, "status 不合法");
  }
  const distribution = readRequiredString(
    form.get("distribution"),
    "distribution",
  );
  if (distribution !== "archive" && distribution !== "external") {
    throw new HttpError(400, "distribution 不合法");
  }
  return {
    distribution: distribution as "archive" | "external",
    originalTitle: readRequiredString(
      form.get("original_title"),
      "original_title",
    ),
    chineseTitle: readNullableString(form.get("chinese_title")),
    description: readNullableString(form.get("description")),
    moreInfo: parseWorkMoreInfoJson(form.get("more_info")),
    originalReleaseDate: readNullableString(form.get("original_release_date")),
    engineFamily: readRequiredString(
      form.get("engine_family"),
      "engine_family",
    ),
    isOriginal: form.has("is_original"),
    isTranslation: form.has("is_translation"),
    language: readRequiredString(form.get("language"), "language"),
    status: status as "published" | "hidden",
    aliases: readList(form.get("aliases")),
    tags: readList(form.get("tags")),
    characters: parseCharacterSelectionsJson(form.get("characters")),
    authors: parseTranslatorSelectionsJson(form.get("authors")),
    extraStaff: parseExtraStaffJson(form.get("extra_staff")),
    translators: parseTranslatorSelectionsJson(form.get("translators")),
    downloadUrl: readNullableString(form.get("download_url")),
    sourceUrl: readNullableString(form.get("source_url")),
  };
}

function parseWorkId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new HttpError(400, "作品 ID 不合法");
  return id;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} 不能为空`);
  }
  return value.trim();
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new HttpError(400, "文本字段格式不合法");
  return value.trim() || null;
}

function readList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,，\r\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
