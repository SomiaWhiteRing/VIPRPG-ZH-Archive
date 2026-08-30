import {
  assertObjectUploadAllowed,
  findExistingObjects,
  insertBlobRecord,
} from "@/lib/server/db/archive-objects";
import { sha256Hex } from "@/lib/server/crypto/sha256";
import { HttpError } from "@/lib/server/http/json";
import { putBlob } from "@/lib/server/storage/archive-bucket";

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

export async function storeWorkImages(files: File[]): Promise<string[]> {
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
