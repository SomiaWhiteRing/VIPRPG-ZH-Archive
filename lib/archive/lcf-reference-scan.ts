import schema from "./lcf-scan-schema.json";

export type ResourceFile = { path: string; size: number; sha256: string };
export type ReferenceObserver = (bytes: Uint8Array, source: string, kind: string, id: number, parameters?: number[]) => void;
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
// Keep the shared scan budget high enough for large archives while retaining a
// finite guard against malformed data causing unbounded work.
const ANALYSIS_STEP_LIMIT = 20_000_000;
const normalize = (value: string) => value.replaceAll("\\", "/").normalize("NFC").toLowerCase();
const stem = (path: string) => normalize(path).split("/").at(-1)!.replace(/\.[^.]*$/, "");
const mapPath = (id: number) => `map${String(id).padStart(4, "0")}.lmu`;
type MapInfo = { type: number; parent: number; hasAreaRect: boolean };

export function mayUseDynamicPictureName(parameters: readonly number[]): boolean {
  if (parameters[0] >= 50000) return true;
  if (parameters.length <= 16) return false;
  // RPG Maker 2003 1.12 adds display options through parameter 29.
  // Parameter 19 enables filename substitution; 17 beyond 0/1 may contain
  // Maniac string-variable flags. Unknown layouts remain conservative.
  return parameters.length !== 30 || ![0, 1].includes(parameters[17]) || parameters[19] !== 0;
}

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
  private readonly mapInfos = new Map<number, MapInfo>();
  private steps = 0;
  private totalBytes = 0;
  private currentPath = "";

  constructor(private readonly files: readonly ResourceFile[], isCandidate: (file: ResourceFile) => boolean,
    private readonly observe?: ReferenceObserver) {
    this.candidates = files.filter(isCandidate);
    for (const file of this.candidates) {
      const name = stem(file.path);
      const bucket = this.names.get(name);
      if (bucket) bucket.push(file);
      else this.names.set(name, [file]);
    }
    if (!this.candidates.length && !observe) return;
    for (const file of files) {
      const path = normalize(file.path);
      // Stock RPG2000/2003 runtime libraries are not arbitrary resource loaders.
      // Only accept their root paths; other plugins may load any path.
      if ((path.endsWith(".dll") && path !== "harmony.dll" && path !== "ultimate_rt_eb.dll") ||
          /(?:^|\/)(?:dynrpg|easyrpg)\.ini$/.test(path) ||
          /\.(?:script|lua|js)$/.test(path)) {
        this.protect("*", `存在未分析的扩展：${file.path}`);
      }
    }
  }

  get needsScan(): boolean {
    if (this.steps > ANALYSIS_STEP_LIMIT || this.totalBytes > 256 * 1024 * 1024) return false;
    // Protection prevents pruning; read-only observers can still collect known
    // static references for RTP restoration within the same analysis budgets.
    return Boolean(this.observe) || (this.candidates.length > 0 && !this.protectedDirs.has("*"));
  }

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
      for (const [id, info] of this.mapInfos) {
        // Standard areas have type 2. Some games encode their area nodes as
        // type 0: accept only a valid rectangle attached to a scanned real map.
        // Names such as AREA0472 alone are not evidence that a map is optional.
        const isArea = (info.type === 2 || info.type === 0) && info.hasAreaRect &&
          info.parent > 0 && info.parent !== id && this.mapInfos.get(info.parent)?.type === 1 &&
          this.seenCore.has(mapPath(info.parent));
        if (isArea) continue;
        const path = mapPath(id);
        // Missing map files are advisory: prune against the files actually
        // supplied. Existing but unscanned files are still protected above.
        if (id > 0 && !this.seenCore.has(path) && this.reasons.size < 20) {
          this.reasons.add(`地图树中的地图未分析：${path}`);
        }
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
    const decoded = new Set<string>();
    for (const decoder of decoders) {
      let value: string;
      try { value = decoder.decode(bytes); } catch { continue; }
      if (decoded.has(value)) continue;
      decoded.add(value);
      // Standard message text and skill/item names can start with $A..$Z/$a..$z
      // (ExFont glyphs). Keep the patch heuristic for other strings, especially
      // sound names and comments, and for nonstandard prefixes such as $[x,y].
      const startsWithExFont = allowsExFont && /^\s*\$[A-Za-z]/.test(value);
      if (!startsWithExFont && /^\s*[@$]/.test(value)) this.protect("*", `${this.currentPath}：存在扩展命令字符串`);
      const base = normalize(value).split("/").at(-1)!;
      for (const name of [base, base.replace(/\.[^.]*$/, "")]) {
        for (const file of this.names.get(name) ?? []) this.referenced.add(file.path);
        // All candidates in this bucket are now protected. Across the whole
        // scan each candidate is visited once, even with repeated references.
        this.names.delete(name);
      }
    }
  }

  private tick(depth: number): void {
    if (++this.steps > ANALYSIS_STEP_LIMIT || depth > 32) throw new Error("超过分析复杂度限制");
  }

  private structure(reader: Reader, type: string, depth: number, eofAllowed = false, mapInfo?: MapInfo): void {
    const fields = structures[type];
    if (!fields) throw new Error(`未支持的结构：${type}`);
    const seen = new Set<number>();
    let animationName: Uint8Array | undefined;
    let largeAnimation = 0;
    while (reader.remaining) {
      this.tick(depth);
      const id = reader.integer();
      if (!id) {
        if (animationName) this.observe?.(animationName, this.currentPath, type, 2, [largeAnimation]);
        return;
      }
      if (seen.has(id)) throw new Error(`重复字段：${type}/${id}`);
      seen.add(id);
      const block = new Reader(reader.take(reader.integer()));
      const kind = fields[id];
      if (!kind) {
        if (!this.observe) throw new Error(`未支持的字段：${type}/${id}`);
        // Field payloads are length-delimited; skip unknown extension fields.
        this.protect("*", `${this.currentPath}：未支持的字段：${type}/${id}`);
        continue;
      }
      if (kind === "string") {
        const bytes = block.take(block.remaining);
        this.string(bytes, id === 1 && (type === "Skill" || type === "Item"));
        if (type === "Animation" && id === 2) animationName = bytes;
        else this.observe?.(bytes, this.currentPath, type, id);
      }
      else if (kind === "commands") this.commands(block);
      else if (kind === "moves") this.moves(block);
      else if (kind.startsWith("array:")) this.array(block, kind.slice(6), depth + 1);
      else if (kind.startsWith("struct:")) this.structure(block, kind.slice(7), depth + 1);
      else if (mapInfo && (id === 2 || id === 4)) {
        const value = block.integer();
        if (id === 2) mapInfo.parent = value;
        else mapInfo.type = value;
      }
      else if (mapInfo && id === 51) {
        const bytes = block.take(block.remaining);
        if (bytes.length !== 16) throw new Error("地图区域矩形长度无效");
        const rect = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const left = rect.getInt32(0, true), top = rect.getInt32(4, true);
        const right = rect.getInt32(8, true), bottom = rect.getInt32(12, true);
        mapInfo.hasAreaRect = left >= 0 && top >= 0 && right > left && bottom > top;
      }
      else {
        const bytes = block.take(block.remaining);
        if (type === "Animation" && id === 3) largeAnimation = bytes.some((byte) => byte !== 0) ? 1 : 0;
      }
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
      if (ids.has(id)) throw new Error("数组 ID 重复");
      ids.add(id);
      const mapInfo = type === "MapInfo" ? { type: -1, parent: 0, hasAreaRect: false } : undefined;
      this.structure(reader, type, depth + 1, false, mapInfo);
      if (mapInfo) this.mapInfos.set(id, mapInfo);
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
      const bytes = reader.take(reader.integer());
      this.string(bytes, code === 10110 || code === 20110);
      const count = reader.integer();
      if (count > reader.remaining || count > 100_000) throw new Error("事件参数数量无效");
      const parameters = Array.from({ length: count }, () => reader.integer());
      this.observe?.(bytes, this.currentPath, "command", code, parameters);
      if (!commandNames[code]) {
        if (!this.observe) throw new Error(`未支持的事件指令：${code}`);
        // The command envelope has already been read. Preserve all candidates
        // and keep observing subsequent standard commands without guessing.
        this.protect("*", `${this.currentPath}：未支持的事件指令：${code}`);
        continue;
      }
      if (code === 11330) {
        if (parameters.length < 4 || parameters.slice(4).some((value) => value > 255)) throw new Error("移动路线参数无效");
        this.moves(new Reader(Uint8Array.from(parameters.slice(4))));
      }
      if (code === 11110 && mayUseDynamicPictureName(parameters)) {
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
        const bytes = reader.take(reader.integer());
        this.string(bytes);
        this.observe?.(bytes, this.currentPath, "move", code);
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
