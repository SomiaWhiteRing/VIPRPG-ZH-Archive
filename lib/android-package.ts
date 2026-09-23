import { readZipEntry, type PackageReader } from "./package-zip";

export type AndroidBuildInfo = {
  version: string;
  versionCode: number;
  applicationBuildId: string;
  target: "android-universal";
};

const invalid = () => new Error("无法识别 VIPRPG Android 安装包，请上传 GitHub 构建的原始发布 APK");
const androidNamespace = "http://schemas.android.com/apk/res/android";

// Android's compiled XML stores strings separately and attributes as typed values.
// Read the real manifest so the website and Android use the same version identity.
function readManifest(bytes: Uint8Array): AndroidBuildInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  if (u16(0) !== 3 || u16(2) !== 8 || u32(4) !== bytes.length) throw invalid();
  let strings: string[] | undefined;
  const string = (index: number) => {
    if (!strings || index >= strings.length) throw invalid();
    return strings[index];
  };
  const stack: string[] = [];
  let packageName: unknown, version: unknown, versionCode: unknown;
  let manifest = false, application = false;
  for (let cursor = 8; cursor < bytes.length;) {
    const type = u16(cursor), headerSize = u16(cursor + 2), size = u32(cursor + 4);
    const end = cursor + size;
    if (headerSize < 8 || size < headerSize || end > bytes.length) throw invalid();
    if (type === 1) {
      if (strings || headerSize < 28) throw invalid();
      const count = u32(cursor + 8), styles = u32(cursor + 12);
      const utf8 = (u32(cursor + 16) & 0x100) !== 0;
      const start = cursor + u32(cursor + 20);
      const styleStart = u32(cursor + 24);
      const limit = styleStart ? cursor + styleStart : end;
      if (count > 16384 || start < cursor + headerSize + (count + styles) * 4 || start > limit || limit > end) throw invalid();
      strings = [];
      for (let i = 0; i < count; i++) {
        let offset = start + u32(cursor + headerSize + i * 4);
        const length = () => {
          if (offset + (utf8 ? 1 : 2) > limit) throw invalid();
          const first = utf8 ? bytes[offset++] : u16((offset += 2) - 2);
          if (!(first & (utf8 ? 0x80 : 0x8000))) return first;
          if (offset + (utf8 ? 1 : 2) > limit) throw invalid();
          const second = utf8 ? bytes[offset++] : u16((offset += 2) - 2);
          return utf8 ? (first & 0x7f) * 256 + second : (first & 0x7fff) * 65536 + second;
        };
        let byteLength = length();
        byteLength = utf8 ? length() : byteLength * 2;
        if (offset + byteLength + (utf8 ? 1 : 2) > limit || bytes[offset + byteLength] !== 0 || (!utf8 && bytes[offset + byteLength + 1] !== 0)) throw invalid();
        strings.push(new TextDecoder(utf8 ? "utf-8" : "utf-16le", { fatal: true }).decode(bytes.subarray(offset, offset + byteLength)));
      }
    } else if (type === 0x0102) {
      if (headerSize !== 16 || size < 36) throw invalid();
      const ext = cursor + headerSize;
      const name = string(u32(ext + 4));
      const attrs = ext + u16(ext + 8), stride = u16(ext + 10), count = u16(ext + 12);
      if (attrs < ext + 20 || stride < 20 || attrs + stride * count > end) throw invalid();
      const values = new Map<string, string | number | null>();
      for (let i = 0; i < count; i++) {
        const attr = attrs + stride * i;
        const ns = u32(attr), key = `${ns === 0xffffffff ? "" : string(ns)}|${string(u32(attr + 4))}`;
        if (values.has(key) || u16(attr + 12) !== 8) throw invalid();
        const valueType = bytes[attr + 15], data = u32(attr + 16);
        if (valueType === 3) values.set(key, string(data));
        else if (valueType >= 0x10 && valueType <= 0x1f) values.set(key, data);
        else values.set(key, null);
      }
      if (stack.length === 0) {
        if (name !== "manifest" || manifest) throw invalid();
        manifest = true;
        packageName = values.get("|package");
        version = values.get(`${androidNamespace}|versionName`);
        versionCode = values.get(`${androidNamespace}|versionCode`);
        if (values.has(`${androidNamespace}|versionCodeMajor`) && values.get(`${androidNamespace}|versionCodeMajor`) !== 0) throw invalid();
      } else if (stack.length === 1 && name === "application") {
        if (application || (values.has(`${androidNamespace}|debuggable`) && values.get(`${androidNamespace}|debuggable`) !== 0)) throw invalid();
        application = true;
      }
      stack.push(name);
    } else if (type === 0x0103) {
      if (headerSize !== 16 || size < 24 || stack.pop() !== string(u32(cursor + 20))) throw invalid();
    }
    cursor = end;
  }
  if (!manifest || !application || stack.length || packageName !== "org.viprpg.archive" || typeof version !== "string" || !version.trim() || version.length > 100 || typeof versionCode !== "number" || !Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw invalid();
  return { version, versionCode, applicationBuildId: `${packageName}:${versionCode}`, target: "android-universal" };
}

export async function readAndroidPackage(size: number, source: PackageReader): Promise<AndroidBuildInfo> {
  try {
    return readManifest(await readZipEntry(size, source, "AndroidManifest.xml", 65536));
  } catch {
    throw invalid();
  }
}

export function readAndroidFile(file: File) {
  return readAndroidPackage(file.size, async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()));
}
