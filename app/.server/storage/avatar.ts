import { inspectWorkImage } from "@/app/.server/storage/work-images";
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
  const info = inspectWorkImage(buffer);
  if (info.format !== "png") throw new HttpError(400, "头像必须是 PNG 图片");
  if (info.width !== 192 || info.height !== 192)
    throw new HttpError(400, "头像尺寸必须精确为 192×192");
}
