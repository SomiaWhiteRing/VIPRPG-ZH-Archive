import SevenZip from "7z-wasm";
import sevenZipWasmUrl from "7z-wasm/7zz.wasm?url";
import { filesWithinArchiveGameRoot } from "./archive-game-root";
import type { UploadSourceEntry } from "./archive-source";
import {
  contentTypeForArchivePath,
  normalizeArchivePath,
} from "@/lib/archive/file-policy";

type SevenZipEntry = {
  path: string;
  archivePath: string;
  size: number;
};

export async function enumerateSevenZipSourceFiles(
  file: File,
): Promise<UploadSourceEntry[]> {
  const signature = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  if ([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c].some((byte, i) => signature[i] !== byte)) {
    throw new Error("所选文件不是有效的 7z 压缩包。");
  }

  let output: string[] = [];
  const sevenZip = await SevenZip({
    locateFile: () => sevenZipWasmUrl,
    print: (line) => output.push(line),
    printErr: (line) => output.push(line),
    stdin: () => {
      throw new Error("暂不支持加密 7z 上传，请先解压后选择游戏文件夹。");
    },
  });
  const fs = sevenZip.FS;
  fs.mkdir("/input");
  // WORKERFS reads the File on demand instead of copying the compressed archive into memory.
  fs.mount(sevenZip.WORKERFS, { blobs: [{ name: "source.7z", data: file }] }, "/input");
  fs.mkdir("/output");

  function run(args: string[]) {
    output = [];
    // The upstream declaration says void, but Emscripten callMain returns the CLI exit code.
    const status = (sevenZip.callMain as (args: string[]) => number)(args);
    if (status !== 0) {
      throw new Error("无法读取 7z 压缩包，文件可能已损坏、加密或属于分卷压缩包。请先解压后选择游戏文件夹。");
    }
    return output.join("\n");
  }

  try {
    const listing = run(["l", "-t7z", "-slt", "-ba", "-sccUTF-8", "--", "/input/source.7z"]);
    const entries = filesWithinArchiveGameRoot(parseSevenZipEntries(listing), "7z");
    fs.writeFile("/selected.txt", entries.map((entry) => entry.archivePath).join("\n"));
    // Extract a solid archive once. Reading individual members repeatedly would decode its blocks again.
    run([
      "x", "-t7z", "-y", "-bd", "-bb0", "-bso0", "-bse1", "-spd",
      "-scsUTF-8", "-i@/selected.txt", "-o/output", "--", "/input/source.7z",
    ]);
    return entries.map((entry) => {
      const outputPath = `/output/${entry.archivePath}`;
      const stat = fs.lstat(outputPath);
      if (!fs.isFile(stat.mode) || stat.size !== entry.size) {
        throw new Error(`7z 文件解压结果异常：${entry.path}`);
      }
      const contentType = contentTypeForArchivePath(entry.path);
      const mtimeMs = stat.mtime.getTime();
      const extracted = new File(
        [new Uint8Array(fs.readFile(outputPath))],
        entry.path.split("/").at(-1)!,
        { type: contentType, lastModified: mtimeMs },
      );
      fs.unlink(outputPath);
      return {
        path: entry.path,
        size: extracted.size,
        mtimeMs,
        contentType,
        bytes: async () => new Uint8Array(await extracted.arrayBuffer()),
      };
    });
  } catch (error) {
    if (error instanceof RangeError || error instanceof WebAssembly.RuntimeError) {
      throw new Error("7z 解压失败或可用内存不足，请先解压后选择游戏文件夹。", { cause: error });
    }
    throw error;
  } finally {
    fs.unmount("/input");
  }
}

function parseSevenZipEntries(listing: string): SevenZipEntry[] {
  const entries: SevenZipEntry[] = [];
  const paths = new Set<string>();
  for (const block of listing.trim().split(/\r?\n\s*\r?\n/)) {
    if (!block) continue;
    const fields = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(" = ");
      const key = line.slice(0, separator);
      if (separator < 1 || fields.has(key)) {
        throw new Error("7z 文件清单无效，或文件名含有不支持的换行符。");
      }
      fields.set(key, line.slice(separator + 3));
    }
    if (fields.get("Encrypted") === "+") {
      throw new Error("暂不支持加密 7z 上传，请先解压后选择游戏文件夹。");
    }
    const rawPath = fields.get("Path") ?? "";
    const path = normalizeArchivePath(rawPath);
    if (
      !path || /^[\\/]/.test(rawPath) || /[:\p{Cc}]/u.test(path) ||
      path.split("/").some((part) => part === "." || part === "..") ||
      fields.has("Symbolic Link") || fields.has("Hard Link") ||
      /\bl[rwx-]{9}\b/.test(fields.get("Attributes") ?? "")
    ) {
      throw new Error(`7z 内含有不支持的路径或链接：${rawPath}`);
    }
    const key = path.normalize("NFC").toLowerCase();
    if (paths.has(key)) throw new Error(`7z 内含有重复或大小写冲突的路径：${path}`);
    paths.add(key);
    if (fields.get("Folder") === "+" || fields.get("Attributes")?.startsWith("D")) continue;
    const size = Number(fields.get("Size"));
    if (!fields.has("Size") || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`7z 文件大小无效：${path}`);
    }
    entries.push({ path, archivePath: path, size });
  }
  return entries;
}
