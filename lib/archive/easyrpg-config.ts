export const easyRpgEngines = ["rpg2k", "rpg2kv150", "rpg2ke", "rpg2k3", "rpg2k3v105", "rpg2k3e"] as const;
export type EasyRpgEngine = typeof easyRpgEngines[number];
export type EasyRpgConfig = {
  schema: "easyrpg-config.v1";
  engine: EasyRpgEngine | null;
  engineSource: "config" | "executable" | "database" | "files" | "fallback";
  encoding: string | null;
  patches: {
    maniac: number;
    dynRpg: boolean;
    keyPatch: boolean;
    easyRpg: boolean;
    commonThisEvent: boolean;
    picUnlock: boolean;
    rpg2k3Commands: boolean;
    antiLagSwitch: number;
    directMenu: number;
  };
};

type SourceFile = { path: string; size: number; bytes: () => Promise<Uint8Array> };
const detectionPaths = new Set(["rpg_rt.exe", "rpg_rt.ldb", "rpg_rt.ini", "easyrpg.ini"]);
export const isEasyRpgDetectionFile = (path: string) => detectionPaths.has(path.toLowerCase());
const engineAliases: Record<string, EasyRpgEngine> = {
  "2000": "rpg2k", "2000v150": "rpg2kv150", "2000e": "rpg2ke",
  "2003": "rpg2k3", "2003v105": "rpg2k3v105", "2003e": "rpg2k3e",
};
const booleanPatches = {
  dynRpg: "DynRPG", keyPatch: "KeyPatch", easyRpg: "EasyRPG",
  commonThisEvent: "CommonThisEvent", picUnlock: "PicUnlock", rpg2k3Commands: "RPG2k3Commands",
} as const;
const integerPatches = { maniac: "Maniac", antiLagSwitch: "AntiLagSwitch", directMenu: "DirectMenu" } as const;

/** Resolve the native Player's engine/patch rules from the unfiltered archive.
 * PE facts follow EasyRPG's EXEReader; DLL detection uses names and file sizes.
 * With no version evidence or declared encoding, keep the native encoding-based
 * fallback rather than substitute a second charset detector for liblcf/ICU.
 */
export async function detectEasyRpgConfig(files: readonly SourceFile[]): Promise<EasyRpgConfig> {
  const entries = new Map(files.map(file => [file.path.toLowerCase(), file]));
  const read = async (path: string, limit = 64 * 1024 ** 2) => {
    const file = entries.get(path);
    if (!file || file.size > limit) return null;
    const bytes = await file.bytes();
    if (bytes.byteLength !== file.size) throw new Error(`引擎检测文件长度不一致：${file.path}`);
    return bytes;
  };
  const [exe, database, rpgIni, easyIni] = await Promise.all([
    read("rpg_rt.exe"), read("rpg_rt.ldb"), read("rpg_rt.ini", 1024 ** 2), read("easyrpg.ini", 1024 ** 2),
  ]);
  const ini = parseIni(easyIni, true), encodingValue = parseIni(rpgIni).get("easyrpg/encoding");
  // RPG_RT.ini declares a numeric code page; liblcf uses atoi, with zero
  // meaning automatic detection. Preserve that interpretation in CLI form.
  const codePage = Number.parseInt(encodingValue ?? "", 10);
  const encoding = Number.isSafeInteger(codePage) && codePage > 0 && codePage <= 0x7fffffff ? String(codePage) : null;
  const patches: EasyRpgConfig["patches"] = {
    maniac: 0, dynRpg: false, keyPatch: false, easyRpg: false,
    commonThisEvent: false, picUnlock: false, rpg2k3Commands: false, antiLagSwitch: 0, directMenu: 0,
  };
  let patchOverride = false;
  for (const [key, name] of Object.entries(booleanPatches)) {
    const value = ini.get(`patch/${name.toLowerCase()}`);
    if (value === undefined) continue;
    patchOverride = true;
    patches[key as keyof typeof booleanPatches] = /^(?:true|yes|on|1)$/i.test(value);
  }
  for (const [key, name] of Object.entries(integerPatches)) {
    const value = ini.get(`patch/${name.toLowerCase()}`);
    if (value === undefined) continue;
    patchOverride = true;
    const number = /^-?\d/.test(value) ? Number.parseInt(value, 10) : Number.NaN;
    patches[key as keyof typeof integerPatches] = Number.isSafeInteger(number) && number >= 0 && number <= 0x7fffffff ? number : 0;
  }
  const configured = ini.get("game/engine") ?? "";
  let engine: EasyRpgEngine | null = Object.hasOwn(engineAliases, configured) ? engineAliases[configured]
    : easyRpgEngines.includes(configured as EasyRpgEngine) ? configured as EasyRpgEngine : null;
  let engineSource: EasyRpgConfig["engineSource"] = "config";
  if (!engine) {
    const detected = exe ? inspectExecutable(exe) : null;
    engine = detected?.engine ?? null;
    engineSource = "executable";
    if (!patchOverride && detected?.maniac) patches.maniac = 1;
  }
  if (!engine) {
    const info = database ? inspectDatabase(database) : { is2003: false, english2000: false };
    const is2003 = info.is2003;
    const english = is2003 ? entries.has("ultimate_rt_eb.dll") : info.english2000;
    engineSource = "database";
    if (english) engine = is2003 ? "rpg2k3e" : "rpg2ke";
    else {
      const harmony = entries.get("harmony.dll"), runtime = entries.get("rpg_rt.exe");
      const mp3 = (!harmony || harmony.size === 473600) && files.some(file => /^music\/[^/]+\.mp3$/i.test(file.path));
      if (mp3 || runtime) {
        const updated = mp3 || runtime!.size > (is2003 ? 927000 : 735000);
        engine = is2003 ? (updated ? "rpg2k3v105" : "rpg2k3") : (updated ? "rpg2kv150" : "rpg2k");
        engineSource = "files";
      } else {
        // Native fallback is newer for 2003 / CP932, older for other 2000.
        engine = is2003 ? "rpg2k3v105" : encoding ? (encoding === "932" ? "rpg2kv150" : "rpg2k") : null;
        engineSource = "fallback";
      }
    }
  }
  if (!patchOverride) {
    patches.keyPatch = entries.has("harmony.dll");
    patches.dynRpg = entries.has("dynloader.dll");
    if (entries.has("accord.dll")) patches.maniac = 1;
  }
  return { schema: "easyrpg-config.v1", engine, engineSource, encoding, patches };
}

export function parseEasyRpgConfig(value: unknown): EasyRpgConfig {
  if (!value || typeof value !== "object") throw new Error("Invalid EasyRPG config");
  const v = value as EasyRpgConfig;
  if (v.schema !== "easyrpg-config.v1" || (v.engine !== null && !easyRpgEngines.includes(v.engine)) ||
      !["config", "executable", "database", "files", "fallback"].includes(v.engineSource) ||
      (v.encoding !== null && (typeof v.encoding !== "string" || !/^\w[\w.-]{0,63}$/.test(v.encoding))) ||
      !v.patches || typeof v.patches !== "object") throw new Error("Invalid EasyRPG config");
  for (const key of Object.keys(booleanPatches) as (keyof typeof booleanPatches)[]) {
    if (typeof v.patches[key] !== "boolean") throw new Error("Invalid EasyRPG patch config");
  }
  for (const key of Object.keys(integerPatches) as (keyof typeof integerPatches)[]) {
    if (!Number.isSafeInteger(v.patches[key]) || v.patches[key] < 0 || v.patches[key] > 0x7fffffff) throw new Error("Invalid EasyRPG patch config");
  }
  return v;
}

export function easyRpgConfigArguments(config: EasyRpgConfig): string[] {
  const { engine, encoding, patches } = parseEasyRpgConfig(config);
  const args = engine ? ["--engine", engine] : [];
  if (encoding) args.push("--encoding", encoding);
  // Any explicit patch option disables all native patch autodetection.
  // Supply the site's supported patches, including explicit false/zero values.
  // Destiny is outside the archive's scope and has no CLI flag in this runtime.
  const flags = { dynRpg: "dynrpg", keyPatch: "key-patch", easyRpg: "easyrpg",
    commonThisEvent: "common-this", picUnlock: "pic-unlock", rpg2k3Commands: "rpg2k3-cmds" } as const;
  for (const [key, name] of Object.entries(flags)) args.push(`--${patches[key as keyof typeof flags] ? "" : "no-"}patch-${name}`);
  for (const [key, name] of [["maniac", "maniac"], ["antiLagSwitch", "antilag-switch"], ["directMenu", "direct-menu"]] as const) {
    if (patches[key]) args.push(`--patch-${name}`, String(patches[key]));
    else args.push(`--no-patch-${name}`);
  }
  return args;
}

function parseIni(bytes: Uint8Array | null, discardInvalid = false): Map<string, string> {
  const values = new Map<string, string>();
  if (!bytes) return values;
  // Detection keys/values are ASCII, independent of the title's code page.
  const text = new TextDecoder("windows-1252").decode(bytes);
  let section = "", previousKey: string | null = null, valid = true;
  for (const raw of text.replace(/^ï»¿/, "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^[;#]/.test(line)) continue;
    if (previousKey && /^\s/.test(raw)) {
      values.set(previousKey, `${values.get(previousKey)}\n${line}`);
      continue;
    }
    line = line.replace(/\s+;.*$/, "").trimEnd();
    const heading = /^\[([^\]]+)\]/.exec(line);
    if (heading) { section = heading[1].toLowerCase(); previousKey = null; continue; }
    const at = line.search(/[=:]/);
    if (at > 0) {
      const key = `${section}/${line.slice(0, at).trim().toLowerCase()}`, value = line.slice(at + 1).trim();
      // liblcf concatenates duplicate INI values instead of choosing the last.
      values.set(key, values.has(key) ? `${values.get(key)}\n${value}` : value);
      previousKey = key;
    } else valid = false;
  }
  return discardInvalid && !valid ? new Map() : values;
}

function inspectDatabase(bytes: Uint8Array) {
  let offset = 0;
  const integer = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      if (offset >= bytes.length) throw new Error("引擎检测数据库截断");
      const byte = bytes[offset++]; value = value * 128 + (byte & 127);
      if (value > 0xffffffff) throw new Error("引擎检测数据库整数无效");
      if (!(byte & 128)) return value;
    }
    throw new Error("引擎检测数据库整数过长");
  };
  const skip = (n: number) => { if (n > bytes.length - offset) throw new Error("引擎检测数据库长度无效"); offset += n; };
  const headerSize = integer();
  if (new TextDecoder().decode(bytes.subarray(offset, offset + headerSize)) !== "LcfDataBase") throw new Error("引擎检测数据库格式无效");
  skip(headerSize);
  let is2003 = false, english2000 = false;
  while (offset < bytes.length) {
    const field = integer(); if (!field) break;
    const size = integer(), end = offset + size;
    if (end > bytes.length) throw new Error("引擎检测数据库字段截断");
    if (field === 26 && size) {
      english2000 = integer() >= 1;
      if (offset > end) throw new Error("引擎检测数据库版本字段截断");
    }
    if (field === 22) {
      while (offset < end) {
        const id = integer(); if (!id) break;
        const length = integer(), next = offset + length;
        if (next > end) throw new Error("引擎检测系统字段截断");
        if (id === 10 && length) {
          is2003 = integer() === 2003;
          if (offset > next) throw new Error("引擎检测系统版本字段截断");
        }
        offset = next;
      }
    }
    offset = end;
  }
  return { is2003, english2000 };
}

function inspectExecutable(bytes: Uint8Array): { engine: EasyRpgEngine | null; maniac: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => at >= 0 && at + 2 <= bytes.length ? view.getUint16(at, true) : 0;
  const u32 = (at: number) => at >= 0 && at + 4 <= bytes.length ? view.getUint32(at, true) : 0;
  const none = { engine: null, maniac: false };
  const pe = u32(0x3c), machine = u16(pe + 4), optional = pe + 0x18, magic = u16(optional);
  if (u16(0) !== 0x5a4d || u32(pe) !== 0x4550 || ![0x14c, 0x8664].includes(machine) || ![0x10b, 0x20b].includes(magic)) return none;
  const resourceRva = u32(optional + (magic === 0x10b ? 0x60 : 0x70) + 16);
  if (!resourceRva) return none;
  let resource = 0, code = 0, cherry = 0, geep = 0;
  for (let i = 0, at = optional + u16(pe + 0x14); i < Math.min(u16(pe + 6), 11); i++, at += 40) {
    const name = u32(at), size = Math.max(u32(at + 8), u32(at + 16)), rva = u32(at + 12);
    if (name === 0x45444f43) code = size;
    if (name === 0x52454843) cherry = size;
    if (name === 0x50454547) geep = size;
    if (!resource && rva <= resourceRva && resourceRva < rva + size) resource = u32(at + 20) + resourceRva - rva;
  }
  if (!resource || resource + 16 > bytes.length) return none;
  const relative = (value: number) => resource + (value & 0x7fffffff);
  const named = (at: number, name: string) => u16(at) === name.length && [...name].every((char, i) => u16(at + 2 + 2 * i) === char.charCodeAt(0));
  const logos = u16(resource + 12) === 1 && named(relative(u32(resource + 16)), "XYZ") ? u16(relative(u32(resource + 20)) + 12) : 0;
  let versionBytes: Uint8Array | null = null;
  const count = Math.min(u16(resource + 12) + u16(resource + 14), 4096);
  for (let i = 0; i < count; i++) {
    const at = resource + 16 + 8 * i;
    if (u32(at) !== 16) continue;
    const directory = relative(u32(at + 4)), entries = Math.min(u16(directory + 12) + u16(directory + 14), 4096);
    for (let j = 0; j < entries; j++) {
      const item = directory + 16 + 8 * j;
      if (u32(item) !== 1) continue;
      let data = relative(u32(item + 4));
      if (u32(item + 4) & 0x80000000) data = resource + u32(data + 20);
      const start = resource + u32(data) - resourceRva, size = u32(data + 4);
      if (start >= 0 && size <= 1024 ** 2 && start + size <= bytes.length) versionBytes = bytes.subarray(start, start + size);
      break;
    }
    break;
  }
  let version: number[] | null = null;
  if (versionBytes) {
    if (new TextDecoder("utf-16le").decode(versionBytes).includes("EasyRPG Player\0")) return none;
    const data = new DataView(versionBytes.buffer, versionBytes.byteOffset, versionBytes.length);
    for (let i = 0; i + 24 <= versionBytes.length; i++) {
      if (data.getUint32(i, true) !== 0xfeef04bd) continue;
      const high = data.getUint32(i + 16, true), low = data.getUint32(i + 20, true);
      version = [(high >>> 16) & 255, high & 255, (low >>> 16) & 255, low & 255]; break;
    }
  }
  if (!version) {
    if (logos === 3) return { engine: "rpg2k", maniac: false };
    if (logos === 1) return { engine: code > 0xb0000 ? (code >= 0xc7400 ? "rpg2k3v105" : "rpg2k3") : "rpg2kv150", maniac: false };
    return none;
  }
  const [major, minor, patch, revision] = version;
  const maniacVersion = major === 1 && minor === 1 && patch === 2 && revision === 1;
  if (!logos) return maniacVersion && !code && !cherry ? { engine: "rpg2k3e", maniac: true } : none;
  if (logos !== 1 || major !== 1) return none;
  if (minor === 6) return { engine: "rpg2ke", maniac: false };
  if (minor === 0) return { engine: patch < 5 ? "rpg2k3" : "rpg2k3v105", maniac: false };
  if (minor === 1) return { engine: "rpg2k3e", maniac: maniacVersion && (geep > 0 || cherry > 0x10000) };
  return none;
}
