import { sha256Hex } from "@/app/.server/crypto/sha256";
import {
  assertObjectUploadAllowed,
  insertBlobRecord,
} from "@/app/.server/db/archive-objects";
import type { AppRuntime } from "@/app/.server/runtime";
import { putBlob } from "@/app/.server/storage/archive-bucket";
import { HttpError } from "@/lib/http";

const MAX_AVATAR_BYTES = 512 * 1024;

export async function storeAvatarPng(
  runtime: AppRuntime,
  buffer: ArrayBuffer,
): Promise<string> {
  assertAvatarPng(buffer);
  const sha256 = await sha256Hex(buffer);
  await assertObjectUploadAllowed(runtime, { kind: "blob", sha256 });
  await putBlob(runtime, sha256, buffer, buffer.byteLength, "image/png");
  await insertBlobRecord(runtime, {
    sha256,
    sizeBytes: buffer.byteLength,
    contentTypeHint: "image/png",
    observedExt: "png",
  });
  return sha256;
}

export function assertAvatarPng(buffer: ArrayBuffer): void {
  if (buffer.byteLength > MAX_AVATAR_BYTES)
    throw new HttpError(413, "头像文件不能超过 512 KiB");
  if (buffer.byteLength < 24) throw new HttpError(400, "PNG 文件不完整");
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value))
    throw new HttpError(400, "PNG 文件签名不正确");
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR")
    throw new HttpError(400, "PNG 文件缺少 IHDR");
  const view = new DataView(buffer);
  if (view.getUint32(16) !== 192 || view.getUint32(20) !== 192)
    throw new HttpError(400, "头像尺寸必须精确为 192×192");
}
