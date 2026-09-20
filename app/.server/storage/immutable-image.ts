import { HttpError } from "@/lib/http";

// A retry reconciles the same immutable object instead of overwriting it.
export async function putImmutableImage(
  bucket: R2Bucket,
  row: { object_key: string; size: number; fingerprint: string; format: string },
  bytes: ArrayBuffer,
) {
  let object = await bucket.head(row.object_key);
  if (!object) {
    object = await bucket.put(row.object_key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: `image/${row.format}`, cacheControl: "no-store" },
      customMetadata: { sha256: row.fingerprint },
      sha256: row.fingerprint,
    });
    if (!object) object = await bucket.head(row.object_key);
  }
  if (!object || object.key !== row.object_key || object.size !== row.size ||
      object.customMetadata?.sha256 !== row.fingerprint ||
      object.httpMetadata?.contentType !== `image/${row.format}`)
    throw new HttpError(409, "存储图片与上传记录不一致，请重试。");
}
