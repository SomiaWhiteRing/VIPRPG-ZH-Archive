import { readZipEntry, type PackageReader } from "./package-zip";

export type WindyBuildInfo = {
  schemaVersion: 1;
  version: string;
  applicationBuildId: string;
  target: "windows-x64";
};
const metadataPath = "WindyTranslator/_internal/build-info.json";
const invalid = () => new Error("无法识别 WindyTranslator 安装包，请上传 GitHub 构建的原始 ZIP");

// Read only the bounded central directory and build metadata, on File or R2.
export async function readWindyPackage(size: number, source: PackageReader): Promise<WindyBuildInfo> {
  try {
    const bytes = await readZipEntry(size, source, metadataPath);
    const decoder = new TextDecoder("utf-8", { fatal: true });
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
