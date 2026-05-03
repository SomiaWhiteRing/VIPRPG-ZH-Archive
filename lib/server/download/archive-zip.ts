import { unzipSync } from "fflate";
import type { ArchiveManifest, ArchiveManifestFile } from "@/lib/archive/manifest";
import { getBlob, getCorePack } from "@/lib/server/storage/archive-bucket";
import {
  createZipStream,
  estimateZipStreamSize,
  type ZipStreamEntry,
} from "@/lib/server/download/zip-stream";

type CorePackEntries = Map<string, Uint8Array>;

export function createArchiveZipStream(manifest: ArchiveManifest): ReadableStream<Uint8Array> {
  const corePackCache = new Map<string, Promise<CorePackEntries>>();
  const entries = buildArchiveZipEntries(manifest, corePackCache);

  return createZipStream(entries);
}

export function createFixedLengthArchiveZipStream(
  manifest: ArchiveManifest,
  expectedLength: number,
): ReadableStream<Uint8Array> {
  if (typeof FixedLengthStream === "undefined") {
    return createArchiveZipStream(manifest);
  }

  const { readable, writable } = new FixedLengthStream(expectedLength);

  createArchiveZipStream(manifest)
    .pipeTo(writable)
    .catch((error: unknown) => {
      console.error(
        "Archive fixed-length ZIP stream failed",
        error instanceof Error ? error.message : error,
      );
    });

  return readable;
}

export function estimateArchiveZipSize(manifest: ArchiveManifest): number {
  return estimateZipStreamSize(buildArchiveZipEntries(manifest));
}

function buildArchiveZipEntries(
  manifest: ArchiveManifest,
  corePackCache?: Map<string, Promise<CorePackEntries>>,
): ZipStreamEntry[] {
  return manifest.files.slice().sort(compareManifestFiles).map((file) => ({
    path: file.path,
    size: file.size,
    crc32: file.crc32,
    mtimeMs: file.mtimeMs,
    open: () => {
      if (!corePackCache) {
        throw new Error("ZIP entry stream was opened during size estimation");
      }

      return openManifestFile(file, manifest, corePackCache);
    },
  }));
}

function compareManifestFiles(
  left: ArchiveManifestFile,
  right: ArchiveManifestFile,
): number {
  return (left.pathSortKey || left.path.toLowerCase()).localeCompare(
    right.pathSortKey || right.path.toLowerCase(),
  );
}

async function openManifestFile(
  file: ArchiveManifestFile,
  manifest: ArchiveManifest,
  corePackCache: Map<string, Promise<CorePackEntries>>,
): Promise<ReadableStream<Uint8Array>> {
  const storage = file.storage;

  if (storage.kind === "blob") {
    const object = await getBlob(storage.blobSha256);

    if (!object?.body) {
      throw new Error(`Missing blob object: ${storage.blobSha256}`);
    }

    return object.body;
  }

  const corePack = manifest.corePacks.find((item) => item.id === storage.packId);

  if (!corePack) {
    throw new Error(`Missing core pack declaration: ${storage.packId}`);
  }

  let entriesPromise = corePackCache.get(corePack.sha256);

  if (!entriesPromise) {
    entriesPromise = loadCorePackEntries(corePack.sha256);
    corePackCache.set(corePack.sha256, entriesPromise);
  }

  const entries = await entriesPromise;
  const bytes = entries.get(storage.entry);

  if (!bytes) {
    throw new Error(`Missing core pack entry: ${storage.entry}`);
  }

  return streamBytes(bytes);
}

async function loadCorePackEntries(sha256: string): Promise<CorePackEntries> {
  const object = await getCorePack(sha256);

  if (!object) {
    throw new Error(`Missing core pack object: ${sha256}`);
  }

  const unzipped = unzipSync(new Uint8Array(await object.arrayBuffer()));
  const entries = new Map<string, Uint8Array>();

  for (const [path, bytes] of Object.entries(unzipped)) {
    entries.set(path, bytes);
  }

  return entries;
}

function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
