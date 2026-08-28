import { requirePermission } from "@/lib/server/auth/authorize";
import { createExternalWork } from "@/lib/server/db/game-library";
import { assertObjectUploadAllowed, insertBlobRecord, findExistingObjects } from "@/lib/server/db/archive-objects";
import { sha256Hex } from "@/lib/server/crypto/sha256";
import { putBlob } from "@/lib/server/storage/archive-bucket";
import { HttpError, json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type ExternalMetadataPayload = {
  originalTitle?: unknown;
  chineseTitle?: unknown;
  description?: unknown;
  engineFamily?: unknown;
  isOriginal?: unknown;
  language?: unknown;
  aliases?: unknown;
  tags?: unknown;
  characters?: unknown;
  creatorName?: unknown;
  creatorUrl?: unknown;
};

export async function POST(request: Request) {
  const auth = await requirePermission(request, "work.external_create");
  if ("response" in auth) return auth.response;

  try {
    const form = await request.formData();
    const metadata = parseMetadata(form.get("metadata"));
    const downloadUrl = readRequiredString(form.get("download_url"), "download_url");
    const cover = readImageFile(form.get("cover"), "cover");
    const browsingImages = form
      .getAll("browsing_images[]")
      .map((value) => readImageFile(value, "browsing_images[]"));
    const imageFiles = [cover, ...browsingImages];
    const previewBlobSha256s = await storeImages(imageFiles);
    const result = await createExternalWork({
      user: auth.user,
      ...metadata,
      previewBlobSha256s,
      downloadUrl,
    });
    return json({ ok: true, workId: result.workId }, { status: 201 });
  } catch (error) {
    return jsonError("外链作品创建失败", error);
  }
}

function parseMetadata(value: FormDataEntryValue | null): {
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  engineFamily: string;
  isOriginal: boolean;
  language: string;
  aliases: string[];
  tags: string[];
  characters: string[];
  creatorName: string | null;
  creatorUrl: string | null;
} {
  if (typeof value !== "string") throw new HttpError(400, "metadata 必须是 JSON 字符串");
  let parsed: ExternalMetadataPayload;
  try {
    const candidate: unknown = JSON.parse(value);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("metadata must be an object");
    }
    parsed = candidate as ExternalMetadataPayload;
  } catch {
    throw new HttpError(400, "metadata JSON 格式不合法");
  }
  const originalTitle = readRequiredString(parsed.originalTitle, "originalTitle");
  const engineFamily = readRequiredString(parsed.engineFamily, "engineFamily");
  const language = readRequiredString(parsed.language, "language");
  if (typeof parsed.isOriginal !== "boolean") {
    throw new HttpError(400, "isOriginal 必须是布尔值");
  }
  return {
    originalTitle,
    chineseTitle: readNullableString(parsed.chineseTitle),
    description: readNullableString(parsed.description),
    engineFamily,
    isOriginal: parsed.isOriginal,
    language,
    aliases: readStringArray(parsed.aliases, "aliases"),
    tags: readStringArray(parsed.tags, "tags"),
    characters: readStringArray(parsed.characters, "characters"),
    creatorName: readNullableString(parsed.creatorName),
    creatorUrl: readNullableString(parsed.creatorUrl),
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

function readStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, `${field} 必须是字符串数组`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function readImageFile(value: FormDataEntryValue | null, field: string): File {
  if (!(value instanceof File) || value.size <= 0) {
    throw new HttpError(400, `${field} 必须是图片文件`);
  }
  if (!value.type.toLowerCase().startsWith("image/")) {
    throw new HttpError(400, `${field} 必须是图片文件`);
  }
  return value;
}

async function storeImages(files: File[]): Promise<string[]> {
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const body = await file.arrayBuffer();
    const sha256 = await sha256Hex(body);
    if (seen.has(sha256)) {
      hashes.push(sha256);
      continue;
    }
    seen.add(sha256);
    const existing = await findExistingObjects({
      blobSha256: [sha256],
      corePackSha256: [],
    });
    if (!existing.blobs.has(sha256)) {
      await assertObjectUploadAllowed({ kind: "blob", sha256 });
      await putBlob(sha256, body, body.byteLength, file.type);
      await insertBlobRecord({
        sha256,
        sizeBytes: body.byteLength,
        contentTypeHint: file.type,
        observedExt: null,
      });
    }
    hashes.push(sha256);
  }
  return hashes;
}
