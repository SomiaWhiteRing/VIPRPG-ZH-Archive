import { Unzip, UnzipInflate } from "fflate";
import type { ArchiveManifest } from "@/lib/archive/manifest";
import { crc32 } from "@/lib/archive/crc32";
import { normalizeSha256, sha256Hex } from "@/lib/server/crypto/sha256";
import { HttpError } from "@/lib/server/http/json";
import { getCorePack } from "@/lib/server/storage/archive-bucket";

type ExpectedEntry = {
  path: string;
  sha256: string;
  size: number;
  crc32: number;
};

export type CorePackMetadata = {
  id: number;
  sha256: string;
  sizeBytes: number;
  uncompressedSizeBytes: number;
  fileCount: number;
};

/**
 * Verify the uploaded core-pack ZIP against the manifest entry ledger.
 * The stream is decompressed one entry at a time, keeping memory bounded by
 * the largest core file rather than materialising the whole archive.
 */
export async function validateCorePackReferences(
  manifest: Pick<ArchiveManifest, "files" | "corePacks">,
  metadataBySha256: ReadonlyMap<string, CorePackMetadata>,
): Promise<void> {
  const expectedByPack = validateCorePackMetadataAndEntries(
    manifest,
    metadataBySha256,
  );

  for (const pack of manifest.corePacks) {
    const corePackSha256 = normalizeSha256(pack.sha256);
    const expected = expectedByPack.get(pack.id)!;
    const object = await getCorePack(corePackSha256);
    if (!object) {
      throw new HttpError(409, `Core-pack object is missing: ${pack.sha256}`);
    }
    if (typeof object.size === "number" && object.size !== pack.size) {
      throw new HttpError(
        409,
        `Core-pack object size does not match manifest: ${pack.id}`,
      );
    }

    try {
      if (object.body) {
        await verifyZipStream(object.body, expected);
      } else {
        await verifyZipBytes(
          new Uint8Array(await object.arrayBuffer()),
          expected,
        );
      }
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
): Promise<void> {
  const checks: Promise<void>[] = [];
  const seen = new Set<string>();
  let streamError: HttpError | null = null;
  const unzip = new Unzip((file) => {
    const entry = expected.get(file.name);
    if (!entry || seen.has(file.name)) {
      streamError ??= new HttpError(
        400,
        `Unexpected or duplicate core-pack entry: ${file.name}`,
      );
      file.ondata = () => undefined;
      try {
        file.start();
      } catch {
        // The malformed-entry error above is the useful failure to report.
      }
      return;
    }

    if (file.compression !== 0 && file.compression !== 8) {
      streamError ??= new HttpError(
        400,
        `Unsupported core-pack compression: ${file.name}`,
      );
    }
    if (file.originalSize !== undefined && file.originalSize !== entry.size) {
      streamError ??= new HttpError(
        400,
        `Core-pack entry size mismatch: ${file.name}`,
      );
    }

    seen.add(file.name);
    const chunks: Uint8Array[] = [];
    let resolveCheck!: () => void;
    let rejectCheck!: (error: unknown) => void;
    const check = new Promise<void>((resolve, reject) => {
      resolveCheck = resolve;
      rejectCheck = reject;
    });
    checks.push(check);

    file.ondata = (error, data, final) => {
      if (error) {
        rejectCheck(
          new HttpError(400, `Core-pack entry could not be read: ${file.name}`),
        );
        return;
      }
      if (data) chunks.push(data.slice());
      if (!final) return;

      void verifyEntryBytes(entry, chunks)
        .then(resolveCheck)
        .catch(rejectCheck);
    };

    try {
      file.start();
    } catch (error) {
      rejectCheck(error);
    }
  });
  unzip.register(UnzipInflate);

  const reader = body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      unzip.push(result.value ?? new Uint8Array(), result.done);
      if (result.done) break;
    }
  } finally {
    reader.releaseLock();
  }

  await Promise.all(checks);
  if (streamError) throw streamError;
  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].find((name) => !seen.has(name));
    throw new HttpError(
      400,
      `Core-pack entry is missing: ${missing ?? "unknown"}`,
    );
  }
}

async function verifyZipBytes(
  bytes: Uint8Array,
  expected: Map<string, ExpectedEntry>,
): Promise<void> {
  let error: unknown = null;
  await verifyZipStream(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    expected,
  ).catch((caught) => {
    error = caught;
  });
  if (error) throw error;
}

async function verifyEntryBytes(
  entry: ExpectedEntry,
  chunks: Uint8Array[],
): Promise<void> {
  const bytes = concatChunks(chunks);
  if (bytes.byteLength !== entry.size || crc32(bytes) !== entry.crc32) {
    throw new HttpError(
      400,
      `Core-pack entry checksum mismatch: ${entry.path}`,
    );
  }
  const actualSha256 = await sha256Hex(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  if (actualSha256 !== entry.sha256) {
    throw new HttpError(400, `Core-pack entry SHA-256 mismatch: ${entry.path}`);
  }
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
