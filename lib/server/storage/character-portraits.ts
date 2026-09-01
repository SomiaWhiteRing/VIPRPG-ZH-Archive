import { normalizeSha256 } from "@/lib/server/crypto/sha256";
import { getD1 } from "@/lib/server/db/d1";
import { HttpError } from "@/lib/server/http/json";
import { getBlob } from "@/lib/server/storage/archive-bucket";
import { storeWorkImages } from "@/lib/server/storage/work-images";

const MAX_CHARACTER_PORTRAIT_BYTES = 256 * 1024;
const CHARACTER_PORTRAIT_SIZE = 48;

export function readCharacterPortrait(
  value: FormDataEntryValue | null,
  field = "角色头像",
): File {
  if (!(value instanceof File) || value.size <= 0) {
    throw new HttpError(400, `${field}必须是 PNG 文件`);
  }
  if (value.type.toLowerCase() !== "image/png") {
    throw new HttpError(415, `${field}只支持 PNG 文件`);
  }
  if (value.size > MAX_CHARACTER_PORTRAIT_BYTES) {
    throw new HttpError(413, `${field}不能超过 256 KiB`);
  }
  return value;
}

export async function storeCharacterPortraits(files: File[]): Promise<string[]> {
  for (const file of files) {
    assertCharacterPortraitPng(await file.arrayBuffer(), file.name || "角色头像");
  }
  return storeWorkImages(files);
}

export async function registerUserPortraitFaceSheets(
  hashes: string[],
  userId: number,
): Promise<void> {
  const values = [...new Set(hashes.map(normalizeSha256))];
  if (!values.length) return;
  const database = getD1();
  await database.batch(
    values.map((hash) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO face_sheets(
             blob_sha256,width_px,height_px,source_kind,library_status,created_by_user_id
           ) VALUES(?,48,48,'user_upload','pending',?)`,
        )
        .bind(hash, userId),
    ),
  );
}

export async function ensureCharacterPortraitFaceSheets(
  values: string[],
  userId: number,
): Promise<string[]> {
  const hashes = [...new Set(values.map(normalizeSha256))];
  if (!hashes.length) return [];
  const rows = await getD1()
    .prepare(
      `SELECT blob_sha256
       FROM face_sheets
       WHERE blob_sha256 IN (${hashes.map(() => "?").join(",")})`,
    )
    .bind(...hashes)
    .all<{ blob_sha256: string }>();
  const registered = new Set((rows.results ?? []).map((row) => row.blob_sha256));
  const uploadedPortraits = hashes.filter((hash) => !registered.has(hash));
  await validateCharacterPortraitHashes(uploadedPortraits);
  await registerUserPortraitFaceSheets(uploadedPortraits, userId);
  return hashes;
}

export async function validateCharacterPortraitHashes(values: string[]): Promise<string[]> {
  const hashes = [...new Set(values.map(normalizeSha256))];
  if (!hashes.length) return [];
  const rows = await getD1()
    .prepare(
      `SELECT sha256,size_bytes,content_type_hint
       FROM blobs
       WHERE status='active' AND sha256 IN (${hashes.map(() => "?").join(",")})`,
    )
    .bind(...hashes)
    .all<{
      sha256: string;
      size_bytes: number;
      content_type_hint: string | null;
    }>();
  const byHash = new Map((rows.results ?? []).map((row) => [row.sha256, row]));
  for (const hash of hashes) {
    const row = byHash.get(hash);
    if (
      !row ||
      row.content_type_hint?.toLowerCase() !== "image/png" ||
      row.size_bytes <= 0 ||
      row.size_bytes > MAX_CHARACTER_PORTRAIT_BYTES
    ) {
      throw new HttpError(400, "角色头像必须是有效的 48×48 PNG 文件");
    }
    const object = await getBlob(hash);
    if (!object) throw new HttpError(409, "角色头像文件缺失，请重新上传");
    assertCharacterPortraitPng(await object.arrayBuffer(), "角色头像");
  }
  return hashes;
}

export function assertCharacterPortraitPng(
  buffer: ArrayBuffer,
  field = "角色头像",
): void {
  if (buffer.byteLength > MAX_CHARACTER_PORTRAIT_BYTES) {
    throw new HttpError(413, `${field}不能超过 256 KiB`);
  }
  if (buffer.byteLength < 24) throw new HttpError(400, `${field}文件不完整`);
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw new HttpError(400, `${field}的 PNG 签名不正确`);
  }
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") {
    throw new HttpError(400, `${field}缺少 PNG 尺寸信息`);
  }
  const view = new DataView(buffer);
  if (
    view.getUint32(16) !== CHARACTER_PORTRAIT_SIZE ||
    view.getUint32(20) !== CHARACTER_PORTRAIT_SIZE
  ) {
    throw new HttpError(400, `${field}尺寸必须精确为 48×48`);
  }
}
