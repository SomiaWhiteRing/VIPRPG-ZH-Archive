import { identifyImage, inspectImage, ImageValidationError, IMAGE_HEADER_BYTES, MAX_IMAGE_BYTES } from "@/lib/image-format";
import { sha256Hex } from "@/app/.server/crypto/sha256";
import {
  findObjectStatuses,
  insertBlobRecords,
} from "@/app/.server/db/archive-objects";
import type { AppRuntime } from "@/app/.server/runtime";
import { getBlob, putBlob } from "@/app/.server/storage/archive-bucket";
import { HttpError } from "@/lib/http";

export function readWorkImage(
  value: FormDataEntryValue | null,
  field: string,
): File {
  if (!(value instanceof File) || value.size <= 0) {
    throw new HttpError(400, `${field} 必须是图片文件`);
  }
  if (value.size > MAX_IMAGE_BYTES) throw new HttpError(413, `${field} 不能超过 20 MiB`);
  return value;
}

export async function storeWorkImages(
  runtime: AppRuntime,
  files: File[],
): Promise<string[]> {
  const hashes: string[] = [];
  const unique = new Map<string, { body: ArrayBuffer; contentType: string }>();
  for (const file of files) {
    readWorkImage(file, "图片");
    const body = await file.arrayBuffer();
    const info = inspectWorkImage(body);
    const sha256 = await sha256Hex(body);
    hashes.push(sha256);
    if (!unique.has(sha256))
      unique.set(sha256, { body, contentType: info.contentType });
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

export function inspectWorkImage(body: ArrayBuffer) {
  try { return inspectImage(body); }
  catch (error) {
    if (error instanceof ImageValidationError) throw new HttpError(error.status, error.message);
    throw error;
  }
}

async function getImageBlob(runtime: AppRuntime, sha256: string) {
  const object = await getBlob(runtime, sha256);
  if (!object) throw new HttpError(404, "图片文件不存在");
  if (!object.size || object.size > MAX_IMAGE_BYTES) {
    await object.body.cancel();
    throw new HttpError(413, "图片必须非空且不能超过 20 MiB");
  }
  return object;
}

// Check metadata when assigning stored archive files as work/catalog images.
export async function readValidatedImage(runtime: AppRuntime, sha256: string) {
  const object = await getImageBlob(runtime, sha256);
  const body = await object.arrayBuffer();
  const info = inspectWorkImage(body);
  return { body, ...info };
}

// Display requests only sniff a fixed-size header for a trusted raster MIME.
// Replay the bytes already read, then stream the rest without buffering the file.
export async function streamValidatedImage(runtime: AppRuntime, sha256: string) {
  const object = await getImageBlob(runtime, sha256);
  const reader = object.body.getReader();
  const header = new Uint8Array(Math.min(IMAGE_HEADER_BYTES, object.size));
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < header.length) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      const take = Math.min(value.byteLength, header.length - length);
      header.set(value.subarray(0, take), length);
      length += take;
    }
    const info = identifyImage(header.subarray(0, length));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        chunks.length = 0;
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            reader.releaseLock();
            controller.close();
          } else controller.enqueue(value);
        } catch (error) {
          reader.releaseLock();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try { await reader.cancel(reason); }
        finally { reader.releaseLock(); }
      },
    });
    return { body, size: object.size, ...info };
  } catch (error) {
    try { await reader.cancel(); }
    finally { reader.releaseLock(); }
    if (error instanceof ImageValidationError) throw new HttpError(error.status, error.message);
    throw error;
  }
}
