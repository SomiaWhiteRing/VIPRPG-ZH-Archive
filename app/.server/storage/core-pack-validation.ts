import { normalizeSha256, sha256Hex } from "@/lib/sha256";
import type { AppRuntime } from "@/app/.server/runtime";
import { getCorePack } from "@/app/.server/storage/archive-bucket";
import { corePackKey } from "@/lib/archive/object-keys";
import { Crc32 } from "@/lib/archive/crc32";
import type { ArchiveManifest } from "@/lib/archive/manifest";
import { HttpError } from "@/lib/http";
import { Unzip, UnzipInflate } from "fflate";

type ExpectedEntry = {
  path: string;
  sha256: string;
  size: number;
  crc32: number;
};

type VerifiedPack = { etag: string; entries: ReadonlyMap<string, ExpectedEntry>; weight: number };
const verifiedPacks = new WeakMap<R2Bucket, Map<string, VerifiedPack>>();
const maxVerifiedEntries = 20_000;
const maxVerifiedMetadataBytes = 4 * 1024 * 1024;

function matchesVerifiedEntries(expected: Map<string, ExpectedEntry>, verified: VerifiedPack) {
  if (expected.size !== verified.entries.size) return false;
  for (const [path, entry] of expected) {
    const previous = verified.entries.get(path);
    if (!previous || previous.sha256 !== entry.sha256 || previous.size !== entry.size || previous.crc32 !== entry.crc32) return false;
  }
  return true;
}

function rememberVerifiedPack(bucket: R2Bucket, hash: string, etag: string, entries: Map<string, ExpectedEntry>) {
  if (entries.size > maxVerifiedEntries) return;
  let weight = 256;
  for (const path of entries.keys()) weight += 384 + 2 * path.length;
  if (weight > maxVerifiedMetadataBytes) return;
  let cache = verifiedPacks.get(bucket);
  if (!cache) verifiedPacks.set(bucket, cache = new Map());
  cache.delete(hash);
  cache.set(hash, { etag, entries, weight });
  let count = [...cache.values()].reduce((sum, pack) => sum + pack.entries.size, 0);
  let bytes = [...cache.values()].reduce((sum, pack) => sum + pack.weight, 0);
  while (cache.size > 16 || count > maxVerifiedEntries || bytes > maxVerifiedMetadataBytes) {
    const oldest = cache.keys().next().value!;
    count -= cache.get(oldest)!.entries.size;
    bytes -= cache.get(oldest)!.weight;
    cache.delete(oldest);
  }
}

export type CorePackMetadata = {
  id: number;
  sha256: string;
  sizeBytes: number;
  uncompressedSizeBytes: number;
  fileCount: number;
};

/**
 * Verify the uploaded core-pack ZIP against the manifest entry ledger.
 * Keep one buffer per entry being decoded or hashed; await completed hashes
 * after each input chunk instead of retaining all decompressed entry buffers.
 */
export async function validateCorePackReferences(
  runtime: AppRuntime,
  manifest: Pick<ArchiveManifest, "files" | "corePacks">,
  metadataBySha256: ReadonlyMap<string, CorePackMetadata>,
  onVerifiedEntry?: (path: string, bytes: Uint8Array) => void,
): Promise<void> {
  const expectedByPack = validateCorePackMetadataAndEntries(
    manifest,
    metadataBySha256,
  );

  for (const pack of manifest.corePacks) {
    const corePackSha256 = normalizeSha256(pack.sha256);
    const expected = expectedByPack.get(pack.id)!;
    const verified = verifiedPacks.get(runtime.bucket)?.get(corePackSha256);
    // Reuse only a server-verified ledger for the same immutable stored object.
    // Resource-reference scans still need the actual bytes for their callback.
    if (!onVerifiedEntry && verified && matchesVerifiedEntries(expected, verified)) {
      const object = await runtime.bucket.head(corePackKey(corePackSha256));
      if (!object) throw new HttpError(409, `Core-pack object is missing: ${pack.sha256}`);
      if (object.size === pack.size && object.etag === verified.etag) continue;
    }
    const object = await getCorePack(runtime, corePackSha256);
    if (!object) {
      throw new HttpError(409, `Core-pack object is missing: ${pack.sha256}`);
    }
    if (typeof object.size === "number" && object.size !== pack.size) {
      await object.body?.cancel();
      throw new HttpError(
        409,
        `Core-pack object size does not match manifest: ${pack.id}`,
      );
    }

    try {
      if (object.body) {
        await verifyZipStream(object.body, expected, onVerifiedEntry);
      } else {
        await verifyZipBytes(
          new Uint8Array(await object.arrayBuffer()),
          expected,
          onVerifiedEntry,
        );
      }
      if (object.etag) rememberVerifiedPack(runtime.bucket, corePackSha256, object.etag, expected);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        400,
        `Core-pack ZIP is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
}

export function validateCorePackMetadata(
  manifest: Pick<ArchiveManifest, "files" | "corePacks">,
  metadataBySha256: ReadonlyMap<string, CorePackMetadata>,
): void {
  validateCorePackMetadataAndEntries(manifest, metadataBySha256);
}

function validateCorePackMetadataAndEntries(
  manifest: Pick<ArchiveManifest, "files" | "corePacks">,
  metadataBySha256: ReadonlyMap<string, CorePackMetadata>,
): Map<string, Map<string, ExpectedEntry>> {
  const expectedByPack = new Map<string, Map<string, ExpectedEntry>>();

  for (const file of manifest.files) {
    if (file.storage.kind !== "core_pack") continue;

    const entries = expectedByPack.get(file.storage.packId) ?? new Map();
    if (entries.has(file.storage.entry)) {
      throw new HttpError(
        400,
        `Duplicate core-pack entry: ${file.storage.entry}`,
      );
    }
    entries.set(file.storage.entry, {
      path: file.storage.entry,
      sha256: normalizeSha256(file.sha256),
      size: file.size,
      crc32: file.crc32,
    });
    expectedByPack.set(file.storage.packId, entries);
  }

  for (const pack of manifest.corePacks) {
    const corePackSha256 = normalizeSha256(pack.sha256);
    const expected =
      expectedByPack.get(pack.id) ?? new Map<string, ExpectedEntry>();
    expectedByPack.set(pack.id, expected);
    if (expected.size !== pack.fileCount) {
      throw new HttpError(
        400,
        `Core-pack file count does not match manifest: ${pack.id}`,
      );
    }

    const expectedUncompressedSize = [...expected.values()].reduce(
      (sum, entry) => sum + entry.size,
      0,
    );
    if (expectedUncompressedSize !== pack.uncompressedSize) {
      throw new HttpError(
        400,
        `Core-pack uncompressed size does not match manifest: ${pack.id}`,
      );
    }

    const row = metadataBySha256.get(corePackSha256);
    if (!row) {
      throw new HttpError(409, `Core-pack record is missing: ${pack.sha256}`);
    }
    if (
      row.sizeBytes !== pack.size ||
      row.uncompressedSizeBytes !== pack.uncompressedSize ||
      row.fileCount !== pack.fileCount
    ) {
      throw new HttpError(
        400,
        `Core-pack metadata does not match manifest: ${pack.id}`,
      );
    }
  }

  return expectedByPack;
}

async function verifyZipStream(
  body: ReadableStream<Uint8Array>,
  expected: Map<string, ExpectedEntry>,
  onVerifiedEntry?: (path: string, bytes: Uint8Array) => void,
): Promise<void> {
  const checks: Promise<void>[] = [];
  const seen = new Set<string>();
  let verified = 0;
  const unzip = new Unzip((file) => {
    const entry = expected.get(file.name);
    if (!entry || seen.has(file.name)) {
      throw new HttpError(400, `Unexpected or duplicate core-pack entry: ${file.name}`);
    }
    if (file.compression !== 0 && file.compression !== 8) {
      throw new HttpError(400, `Unsupported core-pack compression: ${file.name}`);
    }
    if (file.originalSize !== undefined && file.originalSize !== entry.size) {
      throw new HttpError(400, `Core-pack entry size mismatch: ${file.name}`);
    }
    seen.add(file.name);
    // Declared ZIP/manifest sizes are still untrusted here. Grow with actual data
    // so a tiny malformed entry cannot force a multi-gigabyte allocation.
    let bytes = new Uint8Array(Math.min(entry.size, 64 * 1024));
    const checksum = new Crc32();
    let length = 0;
    file.ondata = (error, data, final) => {
      if (error) throw new HttpError(400, `Core-pack entry could not be read: ${file.name}`);
      if (data) {
        const required = length + data.byteLength;
        if (required > entry.size) {
          throw new HttpError(400, `Core-pack entry size mismatch: ${file.name}`);
        }
        if (required > bytes.byteLength) {
          const grown = new Uint8Array(Math.min(entry.size, Math.max(required, bytes.byteLength * 2)));
          grown.set(bytes.subarray(0, length));
          bytes = grown;
        }
        bytes.set(data, length);
        length += data.byteLength;
        checksum.update(data);
      }
      if (!final) return;
      if (length !== entry.size || checksum.digest() !== entry.crc32) {
        throw new HttpError(400, `Core-pack entry checksum mismatch: ${entry.path}`);
      }
      const check = sha256Hex(bytes.buffer).then((hash) => {
        if (hash !== entry.sha256) throw new HttpError(400, `Core-pack entry SHA-256 mismatch: ${entry.path}`);
        onVerifiedEntry?.(entry.path, bytes);
        verified++;
      });
      // Await each transport chunk's completed entries before reading more data.
      check.catch(() => undefined);
      checks.push(check);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const reader = body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      unzip.push(result.value ?? new Uint8Array(), result.done);
      await Promise.all(checks);
      checks.length = 0;
      if (result.done) break;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    await Promise.allSettled(checks);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (verified !== expected.size) {
    throw new HttpError(400, "Core-pack contains missing or incomplete entries");
  }
}

async function verifyZipBytes(
  bytes: Uint8Array,
  expected: Map<string, ExpectedEntry>,
  onVerifiedEntry?: (path: string, bytes: Uint8Array) => void,
): Promise<void> {
  await verifyZipStream(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }), expected, onVerifiedEntry);
}
