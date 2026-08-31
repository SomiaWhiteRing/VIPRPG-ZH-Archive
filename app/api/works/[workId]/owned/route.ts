import { requirePermission } from "@/lib/server/auth/authorize";
import {
  getOwnedWorkForEdit,
  updateOwnedWork,
} from "@/lib/server/db/game-library";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { readWorkImage, storeWorkImages } from "@/lib/server/storage/work-images";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workId: string }> },
) {
  const auth = await requirePermission(request, "work.update_own");
  if ("response" in auth) return auth.response;

  try {
    const { workId: rawWorkId } = await context.params;
    const workId = parseWorkId(rawWorkId);
    const current = await getOwnedWorkForEdit(workId, auth.user);
    if (!current) throw new HttpError(404, "作品不存在或不属于当前上传者");
    const form = await request.formData();
    const metadata = parseMetadata(form);
    const imageEntries = form
      .getAll("images[]")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const previewBlobSha256s = imageEntries.length
      ? await storeWorkImages(
          imageEntries.map((value) => readWorkImage(value, "images[]")),
        )
      : current.media
          .filter((media) => media.kind === "preview")
          .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
          .map((media) => media.blobSha256);
    await updateOwnedWork({
      user: auth.user,
      workId,
      ...metadata,
      previewBlobSha256s,
    });
    return json({ ok: true });
  } catch (error) {
    return jsonError("作品资料保存失败", error);
  }
}

function parseMetadata(form: FormData) {
  const status = readRequiredString(form.get("status"), "status");
  if (status !== "published" && status !== "hidden") {
    throw new HttpError(400, "status 不合法");
  }
  return {
    originalTitle: readRequiredString(form.get("original_title"), "original_title"),
    chineseTitle: readNullableString(form.get("chinese_title")),
    description: readNullableString(form.get("description")),
    originalReleaseDate: readNullableString(form.get("original_release_date")),
    engineFamily: readRequiredString(form.get("engine_family"), "engine_family"),
    isOriginal: form.has("is_original"),
    isTranslation: form.has("is_translation"),
    language: readRequiredString(form.get("language"), "language"),
    status: status as "published" | "hidden",
    aliases: readList(form.get("aliases")),
    tags: readList(form.get("tags")),
    characters: readList(form.get("characters")),
    authors: singleName(form.get("author")),
    translators: singleName(form.get("translator")),
    downloadUrl: readNullableString(form.get("download_url")),
    sourceUrl: readNullableString(form.get("source_url")),
  };
}

function parseWorkId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "作品 ID 不合法");
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

function singleName(value: FormDataEntryValue | null): string[] {
  const name = readNullableString(value);
  return name ? [name] : [];
}
