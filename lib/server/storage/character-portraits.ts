import { normalizeSha256 } from "@/lib/server/crypto/sha256";
import { getD1 } from "@/lib/server/db/d1";
import { HttpError } from "@/lib/server/http/json";
import { getBlob } from "@/lib/server/storage/archive-bucket";
import { storeWorkImages } from "@/lib/server/storage/work-images";

const MAX_CHARACTER_FACE_SHEET_BYTES = 256 * 1024;
const CHARACTER_PORTRAIT_CELL_SIZE = 48;
const MAX_CHARACTER_FACE_SHEET_SIZE = 192;

export type CharacterFaceSheetObject = {
  sha256: string;
  width: number;
  height: number;
};

export function readCharacterFaceSheet(
  value: FormDataEntryValue | null,
  field = "脸图素材表",
): File {
  if (!(value instanceof File) || value.size <= 0) {
    throw new HttpError(400, `${field}必须是 PNG 文件`);
  }
  if (value.type.toLowerCase() !== "image/png") {
    throw new HttpError(415, `${field}只支持 PNG 文件`);
  }
  if (value.size > MAX_CHARACTER_FACE_SHEET_BYTES) {
    throw new HttpError(413, `${field}不能超过 256 KiB`);
  }
  return value;
}

export async function storeCharacterFaceSheets(
  files: File[],
): Promise<CharacterFaceSheetObject[]> {
  const dimensions: Array<{ width: number; height: number }> = [];
  for (const file of files) {
    dimensions.push(
      assertCharacterFaceSheetPng(
        await file.arrayBuffer(),
        file.name || "脸图素材表",
      ),
    );
  }
  const hashes = await storeWorkImages(files);
  return hashes.map((sha256, index) => ({
    sha256,
    width: dimensions[index].width,
    height: dimensions[index].height,
  }));
}

export async function registerUserCharacterFaceSheets(
  sheets: CharacterFaceSheetObject[],
  userId: number,
): Promise<void> {
  const values = [...new Map(
    sheets.map((sheet) => [
      normalizeSha256(sheet.sha256),
      { ...sheet, sha256: normalizeSha256(sheet.sha256) },
    ]),
  ).values()];
  if (!values.length) return;
  const database = getD1();
  await database.batch(
    values.map((sheet) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO face_sheets(
             blob_sha256,width_px,height_px,source_kind,library_status,created_by_user_id
           ) VALUES(?,?,?,'user_upload','pending',?)`,
        )
        .bind(sheet.sha256, sheet.width, sheet.height, userId),
    ),
  );
}

export async function ensureCharacterFaceSheets(
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
  const sheets = await validateCharacterFaceSheetHashes(uploadedPortraits);
  await registerUserCharacterFaceSheets(sheets, userId);
  return hashes;
}

export async function validateCharacterFaceSheetHashes(
  values: string[],
): Promise<CharacterFaceSheetObject[]> {
  const hashes = [...new Set(values.map(normalizeSha256))];
  if (!hashes.length) return [];
  const results: CharacterFaceSheetObject[] = [];
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
      row.size_bytes > MAX_CHARACTER_FACE_SHEET_BYTES
    ) {
      throw new HttpError(
        400,
        "脸图素材表必须是 48×48 至 192×192、宽高均为 48 倍数的 PNG 文件",
      );
    }
    const object = await getBlob(hash);
    if (!object) throw new HttpError(409, "脸图素材表文件缺失，请重新上传");
    const dimensions = assertCharacterFaceSheetPng(
      await object.arrayBuffer(),
      "脸图素材表",
    );
    results.push({ sha256: hash, ...dimensions });
  }
  return results;
}

export function assertCharacterFaceSheetPng(
  buffer: ArrayBuffer,
  field = "脸图素材表",
): { width: number; height: number } {
  if (buffer.byteLength > MAX_CHARACTER_FACE_SHEET_BYTES) {
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
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (
    width < CHARACTER_PORTRAIT_CELL_SIZE ||
    height < CHARACTER_PORTRAIT_CELL_SIZE ||
    width > MAX_CHARACTER_FACE_SHEET_SIZE ||
    height > MAX_CHARACTER_FACE_SHEET_SIZE ||
    width % CHARACTER_PORTRAIT_CELL_SIZE !== 0 ||
    height % CHARACTER_PORTRAIT_CELL_SIZE !== 0
  ) {
    throw new HttpError(
      400,
      `${field}尺寸必须在 48×48 至 192×192 之间，且宽高均为 48 的倍数`,
    );
  }
  return { width, height };
}
