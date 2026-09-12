import { requirePermission } from "@/lib/server/auth/authorize";
import type { CharacterCreditSelection } from "@/lib/character-names";
import { parseCharacterSelectionsJson } from "@/lib/server/db/characters";
import { getWorkTranslators, parseTranslatorSelectionsJson, parseExtraStaffJson } from "@/lib/server/db/creators";
import { createExternalWork } from "@/lib/server/db/game-library";
import { readWorkImage, storeWorkImages } from "@/lib/server/storage/work-images";
import {
  ensureCharacterFaceSheets,
  readCharacterFaceSheet,
  storeCharacterFaceSheets,
} from "@/lib/server/storage/character-portraits";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { parseWorkMoreInfoJson } from "@/lib/server/http/work-more-info";
import type { CreatorSelection } from "@/lib/creator-names";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requirePermission(request, "work.external_create");
  if ("response" in auth) return auth.response;

  try {
    const form = await request.formData();
    const metadata = parseMetadata(form);
    const downloadUrl = readRequiredString(form.get("download_url"), "download_url");
    const cover = readWorkImage(form.get("cover"), "cover");
    const browsingImages = form
      .getAll("browsing_images[]")
      .map((value) => readWorkImage(value, "browsing_images[]"));
    const characterFaceSheets = form
      .getAll("character_face_sheets[]")
      .filter((value): value is File => value instanceof File && value.size > 0)
      .map((value) => readCharacterFaceSheet(value));
    const imageFiles = [cover, ...browsingImages];
    const previewBlobSha256s = await storeWorkImages(imageFiles);
    await storeCharacterFaceSheets(characterFaceSheets);
    await ensureCharacterFaceSheets(
      metadata.characters.flatMap((credit) => [
        ...credit.faceSheetBlobSha256s,
        ...(credit.portrait ? [credit.portrait.blobSha256] : []),
      ]),
      auth.user.id,
    );
    const result = await createExternalWork({
      user: auth.user,
      ...metadata,
      previewBlobSha256s,
      downloadUrl,
    });
    return json({ ok: true, workId: result.workId, translators: await getWorkTranslators(result.workId) }, { status: 201 });
  } catch (error) {
    return jsonError("外链作品创建失败", error);
  }
}

function parseMetadata(form: FormData): {
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  moreInfo: ReturnType<typeof parseWorkMoreInfoJson>;
  originalReleaseDate: string | null;
  engineFamily: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  aliases: string[];
  tags: string[];
  characters: CharacterCreditSelection[];
  authors: CreatorSelection[];
  extraStaff: ReturnType<typeof parseExtraStaffJson>;
  translators: CreatorSelection[];
  sourceUrl: string | null;
} {
  return {
    originalTitle: readRequiredString(form.get("original_title"), "original_title"),
    chineseTitle: readNullableString(form.get("chinese_title")),
    description: readNullableString(form.get("description")),
    moreInfo: parseWorkMoreInfoJson(form.get("more_info")),
    originalReleaseDate: readNullableString(form.get("original_release_date")),
    engineFamily: readRequiredString(form.get("engine_family"), "engine_family"),
    isOriginal: form.has("is_original"),
    isTranslation: form.has("is_translation"),
    language: readRequiredString(form.get("language"), "language"),
    aliases: readList(form.get("aliases")),
    tags: readList(form.get("tags")),
    characters: parseCharacterSelectionsJson(form.get("characters")),
    authors: parseTranslatorSelectionsJson(form.get("authors")),
    extraStaff: parseExtraStaffJson(form.get("extra_staff")),
    translators: parseTranslatorSelectionsJson(form.get("translators")),
    sourceUrl: readNullableString(form.get("source_url")),
  };
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
