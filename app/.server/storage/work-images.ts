import { sha256Hex } from "@/app/.server/crypto/sha256";
import {
  findObjectStatuses,
  insertBlobRecords,
} from "@/app/.server/db/archive-objects";
import type { AppRuntime } from "@/app/.server/runtime";
import { putBlob } from "@/app/.server/storage/archive-bucket";
import { HttpError } from "@/lib/http";

export function readWorkImage(
  value: FormDataEntryValue | null,
  field: string,
): File {
  if (!(value instanceof File) || value.size <= 0) {
    throw new HttpError(400, `${field} 必须是图片文件`);
  }
  if (!value.type.toLowerCase().startsWith("image/")) {
    throw new HttpError(400, `${field} 必须是图片文件`);
  }
  return value;
}

export async function storeWorkImages(
  runtime: AppRuntime,
  files: File[],
): Promise<string[]> {
  const hashes: string[] = [];
  const unique = new Map<string, { body: ArrayBuffer; contentType: string }>();
  for (const file of files) {
    const body = await file.arrayBuffer();
    const sha256 = await sha256Hex(body);
    hashes.push(sha256);
    if (!unique.has(sha256))
      unique.set(sha256, { body, contentType: file.type });
  }

  const statuses = await findObjectStatuses(runtime, "blob", [
    ...unique.keys(),
  ]);
  const missing = [...unique.entries()].filter(
    ([sha256]) => statuses.get(sha256) !== "active",
  );
  for (const [sha256] of missing) {
    if (statuses.get(sha256) === "purging") {
      throw new HttpError(
        409,
        "Blob is being garbage-collected; retry the upload",
      );
    }
  }
  for (const [sha256, file] of missing) {
    await putBlob(
      runtime,
      sha256,
      file.body,
      file.body.byteLength,
      file.contentType,
    );
  }
  await insertBlobRecords(
    runtime,
    missing.map(([sha256, file]) => ({
      sha256,
      sizeBytes: file.body.byteLength,
      contentTypeHint: file.contentType,
      observedExt: null,
    })),
  );
  return hashes;
}
