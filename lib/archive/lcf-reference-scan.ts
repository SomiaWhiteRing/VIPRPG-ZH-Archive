import schema from "./lcf-scan-schema.json";

export type ResourceFile = { path: string; size: number; sha256: string };
export type ResourceReferenceReport = {
  status: "no_candidates" | "analyzed" | "preserved";
  candidateCount: number;
  excluded: ResourceFile[];
  protectedDirectories: string[];
  reasons: string[];
};

const structures: Record<string, Record<string, string>> = schema.structs;
const commandNames: Record<string, string> = schema.commands;
const decoders = ["utf-8", "shift_jis", "gb18030", "big5", "euc-kr", "windows-1252"]
  .map((encoding) => new TextDecoder(encoding, { fatal: true }));
const normalize = (value: string) => value.replaceAll("\\", "/").normalize("NFC").toLowerCase();
const stem = (path: string) => normalize(path).split("/").at(-1)!.replace(/\.[^.]*$/, "");

/** Small, read-only LCF visitor. All strings count as references, including editor
 * defaults and unreachable events. Unknown structure/commands disable pruning.
 * The caller defines the candidate scope. Production uses standard engine media.
 */
export class LcfReferenceScan {
  private readonly candidates: ResourceFile[];
  private readonly names = new Map<string, ResourceFile[]>();
  private readonly referenced = new Set<string>();
  private readonly protectedDirs = new Set<string>();
  private readonly reasons = new Set<string>();
  private readonly seenCore = new Set<string>();
  private readonly mapIds = new Set<number>();
  private steps = 0;
  private totalBytes = 0;
  private currentPath = "";

  constructor(private readonly files: readonly ResourceFile[], isCandidate: (file: ResourceFile) => boolean) {
    this.candidates = files.filter(isCandidate);
    for (const file of this.candidates) {
      const name = stem(file.path);
      this.names.set(name, [...(this.names.get(name) ?? []), file]);
    }
    if (!this.candidates.length) return;
    for (const file of files) {
      const path = normalize(file.path);
      // Harmony is the stock RPG2000 audio library. Other plugins may load any path.
      if ((path.endsWith(".dll") && path !== "harmony.dll") ||
          /(?:^|\/)(?:dynrpg|easyrpg)\.ini$/.test(path) ||
          /\.(?:script|lua|js)$/.test(path)) {
        this.protect("*", `存在未分析的扩展：${file.path}`);
      }
    }
  }

  get needsScan(): boolean { return this.candidates.length > 0 && !this.protectedDirs.has("*"); }

  consume(path: string, bytes: Uint8Array): void {
    if (!this.needsScan) return;
    const key = normalize(path);
    if (!/\.(?:ldb|lmt|lmu)$/.test(key) && key !== "rpg_rt.ini") return;
    this.currentPath = path;
    try {
      this.totalBytes += bytes.length;
      if (bytes.length > 64 * 1024 * 1024 || this.totalBytes > 256 * 1024 * 1024) {
        throw new Error("核心文件超过分析大小限制");
      }
      if (this.seenCore.has(key)) throw new Error("核心文件路径冲突");
      this.seenCore.add(key);
      if (key === "rpg_rt.ini") {
        const ini = new TextDecoder("windows-1252").decode(bytes);
        if (/maniac|dynrpg|destiny|picpointer|easyrpg_extensions/i.test(ini)) {
          this.protect("*", "配置声明了扩展引擎");
        }
        const encoding = ini.match(/^\s*Encoding\s*=\s*(\S+)/im)?.[1];
        if (encoding && !/^(?:932|936|950|949|1252|65001|utf-8|shift_jis|gbk|gb18030|big5|windows-1252)$/i.test(encoding)) {
          this.protect("*", `未支持的游戏编码：${encoding}`);
        }
        return;
      }
      const reader = new Reader(bytes);
      const magic = new TextDecoder().decode(reader.take(reader.integer()));
      if (key.endsWith(".ldb") && magic === "LcfDataBase") {
        this.structure(reader, "Database", 0, true);
      } else if (key.endsWith(".lmu") && magic === "LcfMapUnit") {
        this.structure(reader, "Map", 0);
      } else if (key.endsWith(".lmt") && magic === "LcfMapTree") {
        this.array(reader, "MapInfo", 0);
        const count = reader.integer();
        if (count > reader.remaining) throw new Error("地图顺序表无效");
        for (let i = 0; i < count; i++) reader.integer();
        reader.integer();
        this.structure(reader, "Start", 0);
      } else {
        throw new Error("不支持的核心文件格式");
      }
      if (reader.remaining) throw new Error("核心文件存在未解析数据");
    } catch (error) {
      this.protect("*", `${path}：${error instanceof Error ? error.message : "分析失败"}`);
    }
  }

  finish(): ResourceReferenceReport {
    if (this.needsScan) {
      for (const required of ["rpg_rt.ldb", "rpg_rt.lmt"]) {
        if (!this.seenCore.has(required)) this.protect("*", `缺少核心文件：${required}`);
      }
      for (const file of this.files) {
        if ((/\.(?:ldb|lmt|lmu)$/i.test(file.path) || normalize(file.path) === "rpg_rt.ini") && !this.seenCore.has(normalize(file.path))) {
          this.protect("*", `核心文件未完整分析：${file.path}`);
        }
      }
      for (const id of this.mapIds) {
        const path = `map${String(id).padStart(4, "0")}.lmu`;
        if (id > 0 && !this.seenCore.has(path)) this.protect("*", `地图树中的地图未分析：${path}`);
      }
    }
    return {
      status: !this.candidates.length ? "no_candidates" : this.protectedDirs.has("*") ? "preserved" : "analyzed",
      candidateCount: this.candidates.length,
      excluded: this.candidates.filter((file) => !this.protectedDirs.has("*") &&
        !this.protectedDirs.has(normalize(file.path).split("/")[0]) && !this.referenced.has(file.path))
        .map(({ path, size, sha256 }) => ({ path, size, sha256 })).sort((a, b) => a.path.localeCompare(b.path)),
      protectedDirectories: [...this.protectedDirs].sort(), reasons: [...this.reasons].sort(),
    };
  }

  private protect(directory: string, reason: string): void {
    this.protectedDirs.add(directory);
    if (this.reasons.size < 20) this.reasons.add(reason);
  }

  private string(bytes: Uint8Array, allowsExFont = false): void {
    if (!bytes.length) return;
    if (bytes.length > 1024 * 1024) throw new Error("字符串超过分析大小限制");
    for (const decoder of decoders) {
      let value: string;
      try { value = decoder.decode(bytes); } catch { continue; }
      // Standard message text and skill/item names can start with $A..$Z/$a..$z
      // (ExFont glyphs). Keep the patch heuristic for other strings, especially
      // sound names and comments, and for nonstandard prefixes such as $[x,y].
      const startsWithExFont = allowsExFont && /^\s*\$[A-Za-z]/.test(value);
      if (!startsWithExFont && /^\s*[@$]/.test(value)) this.protect("*", `${this.currentPath}：存在扩展命令字符串`);
      const base = normalize(value).split("/").at(-1)!;
      for (const name of [base, base.replace(/\.[^.]*$/, "")]) {
        for (const file of this.names.get(name) ?? []) this.referenced.add(file.path);
      }
    }
  }

  private tick(depth: number): void {
    if (++this.steps > 2_000_000 || depth > 32) throw new Error("超过分析复杂度限制");
  }

  private structure(reader: Reader, type: string, depth: number, eofAllowed = false): void {
    const fields = structures[type];
    if (!fields) throw new Error(`未支持的结构：${type}`);
    const seen = new Set<number>();
    while (reader.remaining) {
      this.tick(depth);
      const id = reader.integer();
      if (!id) return;
      if (seen.has(id)) throw new Error(`重复字段：${type}/${id}`);
      seen.add(id);
      const block = new Reader(reader.take(reader.integer()));
      const kind = fields[id];
      if (!kind) throw new Error(`未支持的字段：${type}/${id}`);
      if (kind === "string") this.string(block.take(block.remaining), id === 1 && (type === "Skill" || type === "Item"));
      else if (kind === "commands") this.commands(block);
      else if (kind === "moves") this.moves(block);
      else if (kind.startsWith("array:")) this.array(block, kind.slice(6), depth + 1);
      else if (kind.startsWith("struct:")) this.structure(block, kind.slice(7), depth + 1);
      else block.take(block.remaining);
      if (block.remaining) throw new Error(`字段长度不一致：${type}/${id}`);
    }
    if (!eofAllowed) throw new Error(`结构缺少结束标记：${type}`);
  }

  private array(reader: Reader, type: string, depth: number): void {
    const count = reader.integer();
    if (count > reader.remaining) throw new Error("数组数量无效");
    const ids = new Set<number>();
    for (let i = 0; i < count; i++) {
      const id = reader.integer();
      if (type === "MapInfo") this.mapIds.add(id);
      if (ids.has(id)) throw new Error("数组 ID 重复");
      ids.add(id);
      this.structure(reader, type, depth + 1);
    }
  }

  private commands(reader: Reader): void {
    if (!reader.remaining) return;
    while (reader.remaining) {
      this.tick(0);
      const code = reader.integer();
      if (!code) { // LCF command list sentinel includes indent/string-size/parameter-count.
        if (reader.integer() || reader.integer() || reader.integer() || reader.remaining) throw new Error("事件结束标记无效");
        return;
      }
      reader.integer(); // indentation
      this.string(reader.take(reader.integer()), code === 10110 || code === 20110);
      const count = reader.integer();
      if (count > reader.remaining || count > 100_000) throw new Error("事件参数数量无效");
      const parameters = Array.from({ length: count }, () => reader.integer());
      if (!commandNames[code]) throw new Error(`未支持的事件指令：${code}`);
      if (code === 11330) {
        if (parameters.length < 4 || parameters.slice(4).some((value) => value > 255)) throw new Error("移动路线参数无效");
        this.moves(new Reader(Uint8Array.from(parameters.slice(4))));
      }
      if (code === 11110 && (count > 16 || parameters[0] >= 50000)) {
        this.protect("picture", `${this.currentPath}：图片指令可能动态指定文件名`);
      }
      // The standard form has only literal filenames. Extra parameters can select
      // Maniac string variables. Do not try to evaluate them.
      const limits: Record<number, [number, string]> = {
        10130: [3, "faceset"], 10630: [3, "charset"], 10640: [2, "faceset"],
        10650: [2, "charset"], 10660: [5, "music"], 10670: [4, "sound"],
        10680: [2, "system"], 11510: [4, "music"], 11550: [3, "sound"],
        11720: [6, "panorama"], 10710: [10, "backdrop"], 13210: [0, "backdrop"],
      };
      const limit = limits[code];
      if (limit && count > limit[0]) this.protect(limit[1], `${this.currentPath}：指令 ${code} 含扩展资源参数`);
    }
    throw new Error("事件列表缺少结束标记");
  }

  private moves(reader: Reader): void {
    while (reader.remaining) {
      this.tick(0);
      const code = reader.integer();
      if (code > 41) throw new Error(`未支持的移动指令：${code}`);
      if (code === 32 || code === 33) reader.integer();
      if (code === 34 || code === 35) {
        this.string(reader.take(reader.integer()));
        reader.integer();
        if (code === 35) { reader.integer(); reader.integer(); }
      }
    }
  }
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get remaining(): number { return this.bytes.length - this.offset; }
  integer(): number {
    let value = 0;
    for (let count = 0; count < 5; count++) {
      if (!this.remaining) throw new Error("核心文件截断");
      const byte = this.bytes[this.offset++];
      value = value * 128 + (byte & 127);
      if (value > 0xffffffff) throw new Error("整数越界");
      if (!(byte & 128)) return value;
    }
    throw new Error("整数编码过长");
  }
  take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) throw new Error("核心文件长度无效");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}
