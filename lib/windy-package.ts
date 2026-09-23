import { inflateSync } from "fflate";

export type WindyBuildInfo = {
  schemaVersion: 1;
  version: string;
  applicationBuildId: string;
  target: "windows-x64";
};
export type PackageReader = (offset: number, length: number) => Promise<Uint8Array>;
const metadataPath = "WindyTranslator/_internal/build-info.json";
const invalid = () => new Error("无法识别温蒂安装包，请上传 GitHub 构建的原始 ZIP");

// Read only the bounded central directory and build metadata, on File or R2.
export async function readWindyPackage(size: number, source: PackageReader): Promise<WindyBuildInfo> {
  const read = async (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > size) throw invalid();
    const bytes = await source(offset, length);
    if (bytes.length !== length) throw invalid();
    return bytes;
  };
  try {
    const tail = await read(Math.max(0, size - 65557), Math.min(size, 65557));
    const end = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let eocd = tail.length - 22;
    while (eocd >= 0 && !(end.getUint32(eocd, true) === 0x06054b50 && eocd + 22 + end.getUint16(eocd + 20, true) === tail.length)) eocd--;
    if (eocd < 0 || end.getUint16(eocd + 4, true) || end.getUint16(eocd + 6, true)) throw invalid();
    const count = end.getUint16(eocd + 10, true);
    const length = end.getUint32(eocd + 12, true), offset = end.getUint32(eocd + 16, true);
    if (!count || count === 65535 || count !== end.getUint16(eocd + 8, true) || length > 8 * 1024 * 1024 || offset + length !== size - tail.length + eocd) throw invalid();
    const directory = await read(offset, length);
    const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let cursor = 0;
    let entry: { offset: number; compressed: number; size: number; method: number; flags: number } | undefined;
    const names = new Set<string>();
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > length || view.getUint32(cursor, true) !== 0x02014b50) throw invalid();
      const nameLength = view.getUint16(cursor + 28, true);
      const next = cursor + 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
      if (next > length) throw invalid();
      const name = decoder.decode(directory.subarray(cursor + 46, cursor + 46 + nameLength)).replaceAll("\\", "/");
      const key = name.toLowerCase();
      if (names.has(key) || name.split("/").some((part) => part === ".." || part === ".")) throw invalid();
      names.add(key);
      if (key === metadataPath.toLowerCase()) {
        if (name !== metadataPath || entry || view.getUint16(cursor + 34, true)) throw invalid();
        entry = { offset: view.getUint32(cursor + 42, true), compressed: view.getUint32(cursor + 20, true), size: view.getUint32(cursor + 24, true), method: view.getUint16(cursor + 10, true), flags: view.getUint16(cursor + 8, true) };
      }
      cursor = next;
    }
    if (cursor !== length || !entry || entry.flags & 1 || ![0, 8].includes(entry.method) || entry.size > 16384 || entry.compressed > 32768) throw invalid();
    const local = await read(entry.offset, 30);
    const header = new DataView(local.buffer, local.byteOffset, local.byteLength);
    if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(6, true) !== entry.flags || header.getUint16(8, true) !== entry.method) throw invalid();
    const nameLength = header.getUint16(26, true);
    if (decoder.decode(await read(entry.offset + 30, nameLength)).replaceAll("\\", "/") !== metadataPath) throw invalid();
    const start = entry.offset + 30 + nameLength + header.getUint16(28, true);
    if (start + entry.compressed > offset) throw invalid();
    const compressed = await read(start, entry.compressed);
    const bytes = entry.method === 0 ? compressed : inflateSync(compressed, { out: new Uint8Array(entry.size + 1) });
    if (bytes.length !== entry.size) throw invalid();
    const info = JSON.parse(decoder.decode(bytes));
    if (info?.schemaVersion !== 1 || info.target !== "windows-x64" || typeof info.version !== "string" || !info.version.trim() || info.version.length > 100 || typeof info.applicationBuildId !== "string" || !/^windy:[A-Za-z0-9:.-]{1,194}$/.test(info.applicationBuildId)) throw invalid();
    return info;
  } catch {
    throw invalid();
  }
}

export function readWindyFile(file: File) {
  return readWindyPackage(file.size, async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()));
}
