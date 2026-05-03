export type ZipStreamEntry = {
  path: string;
  size: number;
  crc32: number;
  mtimeMs: number | null;
  open: () => Promise<ReadableStream<Uint8Array>>;
};

type CentralDirectoryEntry = {
  pathBytes: Uint8Array;
  crc32: number;
  size: number;
  localHeaderOffset: number;
  dosTime: number;
  dosDate: number;
};

const textEncoder = new TextEncoder();
const localFileHeaderSignature = 0x04034b50;
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const zipFlagUtf8 = 0x0800;
const zipMethodStore = 0;
const zipVersion20 = 20;
const uint32Max = 0xffffffff;
const uint16Max = 0xffff;

export function createZipStream(entries: ZipStreamEntry[]): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  writeZip(writer, entries).catch((error: unknown) => {
    writer.abort(error).catch(() => undefined);
  });

  return readable;
}

export function estimateZipStreamSize(entries: ZipStreamEntry[]): number {
  let offset = 0;
  let centralDirectorySize = 0;

  for (const entry of entries) {
    validateZipPath(entry.path);

    const pathBytes = textEncoder.encode(entry.path);

    assertZip16Value(pathBytes.byteLength, "ZIP path length");
    assertZip32Value(entry.size, "ZIP entry size");
    assertZip32Value(entry.crc32, "ZIP entry CRC32");
    assertZip32Value(offset, "ZIP local header offset");

    offset += 30 + pathBytes.byteLength;
    offset += entry.size;
    centralDirectorySize += 46 + pathBytes.byteLength;

    assertSafeZipSize(offset, "ZIP local data size");
    assertSafeZipSize(centralDirectorySize, "ZIP central directory size");
  }

  assertZip16Value(entries.length, "ZIP entry count");
  assertZip32Value(offset, "ZIP central directory offset");
  assertZip32Value(centralDirectorySize, "ZIP central directory size");

  const totalSize = offset + centralDirectorySize + 22;

  assertSafeZipSize(totalSize, "ZIP total size");

  return totalSize;
}

async function writeZip(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  entries: ZipStreamEntry[],
): Promise<void> {
  let offset = 0;
  const centralEntries: CentralDirectoryEntry[] = [];

  async function write(bytes: Uint8Array): Promise<void> {
    await writer.write(bytes);
    offset += bytes.byteLength;
  }

  for (const entry of entries) {
    validateZipPath(entry.path);

    const pathBytes = textEncoder.encode(entry.path);
    const { dosTime, dosDate } = toDosDateTime(entry.mtimeMs);
    const localHeaderOffset = offset;

    assertZip32Value(entry.size, "ZIP entry size");
    assertZip32Value(entry.crc32, "ZIP entry CRC32");
    assertZip32Value(localHeaderOffset, "ZIP local header offset");

    await write(localFileHeader(pathBytes, entry.crc32, entry.size, dosTime, dosDate));

    let actualSize = 0;
    const stream = await entry.open();
    const reader = stream.getReader();

    try {
      while (true) {
        const result = await reader.read();

        if (result.done) {
          break;
        }

        const chunk = normalizeChunk(result.value);
        actualSize += chunk.byteLength;
        await write(chunk);
      }
    } finally {
      reader.releaseLock();
    }

    if (actualSize !== entry.size) {
      throw new Error(
        `ZIP entry size mismatch for ${entry.path}: expected ${entry.size}, got ${actualSize}`,
      );
    }

    centralEntries.push({
      pathBytes,
      crc32: entry.crc32,
      size: actualSize,
      localHeaderOffset,
      dosTime,
      dosDate,
    });
  }

  const centralDirectoryOffset = offset;

  for (const entry of centralEntries) {
    const bytes = centralDirectoryHeader(entry);
    await write(bytes);
  }

  const centralDirectorySize = offset - centralDirectoryOffset;

  assertZip16Value(centralEntries.length, "ZIP entry count");
  assertZip32Value(centralDirectoryOffset, "ZIP central directory offset");
  assertZip32Value(centralDirectorySize, "ZIP central directory size");

  await write(
    endOfCentralDirectory(
      centralEntries.length,
      centralDirectorySize,
      centralDirectoryOffset,
    ),
  );
  await writer.close();
}

function localFileHeader(
  pathBytes: Uint8Array,
  crc32: number,
  size: number,
  dosTime: number,
  dosDate: number,
): Uint8Array {
  assertZip16Value(pathBytes.byteLength, "ZIP path length");
  assertZip32Value(crc32, "ZIP entry CRC32");
  assertZip32Value(size, "ZIP entry size");

  const bytes = new Uint8Array(30 + pathBytes.byteLength);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, localFileHeaderSignature, true);
  view.setUint16(4, zipVersion20, true);
  view.setUint16(6, zipFlagUtf8, true);
  view.setUint16(8, zipMethodStore, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc32, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, pathBytes.byteLength, true);
  view.setUint16(28, 0, true);
  bytes.set(pathBytes, 30);

  return bytes;
}

function centralDirectoryHeader(entry: CentralDirectoryEntry): Uint8Array {
  assertZip16Value(entry.pathBytes.byteLength, "ZIP path length");

  const bytes = new Uint8Array(46 + entry.pathBytes.byteLength);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, centralDirectorySignature, true);
  view.setUint16(4, zipVersion20, true);
  view.setUint16(6, zipVersion20, true);
  view.setUint16(8, zipFlagUtf8, true);
  view.setUint16(10, zipMethodStore, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.pathBytes.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.localHeaderOffset, true);
  bytes.set(entry.pathBytes, 46);

  return bytes;
}

function endOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, endOfCentralDirectorySignature, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return bytes;
}

function validateZipPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid ZIP path: ${path}`);
  }
}

function toDosDateTime(mtimeMs: number | null): { dosTime: number; dosDate: number } {
  const date = mtimeMs === null ? new Date(Date.UTC(2026, 0, 1)) : new Date(mtimeMs);
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  return {
    dosTime: (hours << 11) | (minutes << 5) | seconds,
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
  };
}

function normalizeChunk(value: Uint8Array): Uint8Array {
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
    return value;
  }

  return new Uint8Array(value);
}

function assertZip16Value(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > uint16Max) {
    throw new Error(`${label} exceeds ZIP32 limit`);
  }
}

function assertZip32Value(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > uint32Max) {
    throw new Error(`${label} exceeds ZIP32 limit`);
  }
}

function assertSafeZipSize(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a safe integer`);
  }
}
