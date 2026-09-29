import { LcfReferenceScan, mayUseDynamicPictureName, type ResourceFile, type ReferenceObserver } from "./lcf-reference-scan";

export type MissingResourceReport = {
  missing: { path: string; source: string }[];
  limited: boolean;
  reasons: string[];
};

// Resource fields from liblcf's fields.csv. Ordinary strings (dialogue, names,
// comments) are deliberately excluded. No reachability claim is made.
const fields: Record<string, Record<number, string[]>> = {
  Actor: { 3: ["CharSet"], 15: ["FaceSet"] },
  Sound: { 1: ["Sound"] }, Music: { 1: ["Music"] },
  Animation: { 2: ["Battle"] },
  BattlerAnimationPose: { 2: ["BattleCharSet"] },
  BattlerAnimationWeapon: { 2: ["BattleWeapon"] },
  Chipset: { 2: ["ChipSet"] }, Enemy: { 2: ["Monster"] },
  Terrain: { 4: ["Backdrop"], 21: ["Frame"], 31: ["Frame"] },
  System: { 11: ["CharSet"], 12: ["CharSet"], 13: ["CharSet"],
    17: ["Title"], 18: ["GameOver"], 19: ["System"], 20: ["System2"], 84: ["Backdrop"] },
  MapInfo: { 22: ["Backdrop"] }, EventPage: { 21: ["CharSet"] }, Map: { 32: ["Panorama"] },
};
const commands: Record<number, [string, number]> = {
  10130: ["FaceSet", 3], 10630: ["CharSet", 3], 10640: ["FaceSet", 2],
  10650: ["CharSet", 2], 10660: ["Music", 5], 10670: ["Sound", 4],
  10680: ["System", 2], 10710: ["Backdrop", 10], 11110: ["Picture", 16], 11510: ["Music", 4],
  11550: ["Sound", 3], 11560: ["Movie", 5], 11720: ["Panorama", 6],
  13210: ["Backdrop", 0],
};
const normalize = (path: string) => path.replaceAll("\\", "/").normalize("NFC").toLowerCase();
const extensions = (directory: string) => directory === "Music"
  ? [".wav", ".mid", ".midi", ".mp3", ".ogg", ".oga", ".opus", ".wma"]
  : directory === "Sound" ? [".wav", ".mp3", ".ogg", ".oga", ".opus", ".wma"]
  : directory === "Movie" ? [".avi", ".mpg", ".mpeg"] : [".png", ".bmp", ".xyz"];

/** Advisory only: checks the selected archive, not external RTP installations.
 * Uses a separate visitor so diagnostic limits cannot change pruning decisions. */
export class MissingResourceScan {
  readonly scanner: LcfReferenceScan;
  private readonly paths: Set<string>;
  private readonly missing = new Map<string, { path: string; source: string }>();
  private limited = false;
  private decoders = ["utf-8", "shift_jis", "gb18030", "big5", "euc-kr", "windows-1252"]
    .map((encoding) => new TextDecoder(encoding, { fatal: true }));

  constructor(files: readonly ResourceFile[], ini?: Uint8Array) {
    this.paths = new Set(files.map((file) => normalize(file.path)));
    const encoding = ini && new TextDecoder().decode(ini).match(/^\s*Encoding\s*=\s*(\S+)/im)?.[1];
    if (encoding) {
      const aliases: Record<string, string> = { "932": "shift_jis", "936": "gb18030", "950": "big5",
        "949": "euc-kr", "1252": "windows-1252", "65001": "utf-8" };
      try { this.decoders = [new TextDecoder(aliases[encoding] ?? encoding, { fatal: true })]; }
      catch { this.limited = true; }
    }
    this.scanner = new LcfReferenceScan(files, () => false, this.observe);
  }

  private observe: ReferenceObserver = (bytes, source, kind, id, parameters = []) => {
    let directories: string[] | undefined = fields[kind]?.[id];
    if (kind === "Animation" && id === 2) directories = [parameters[0] ? "Battle2" : "Battle"];
    if (kind === "command") {
      const command = commands[id];
      if (!command) return;
      if (id === 10710 && parameters[2] !== 1) return;
      if (id === 11110 ? mayUseDynamicPictureName(parameters) : parameters.length > command[1]) {
        this.limited = true;
        return;
      }
      directories = [command[0]];
    } else if (kind === "move") {
      directories = id === 34 ? ["CharSet"] : id === 35 ? ["Sound"] : undefined;
    }
    if (!directories || !bytes.length) return;
    if (bytes.length > 2048) { this.limited = true; return; }
    const names: string[] = [];
    for (const decoder of this.decoders) {
      try { names.push(decoder.decode(bytes)); } catch { /* Try other supported encodings. */ }
    }
    if (!names.length) { this.limited = true; return; }
    if (names.some((name) => !name || name === "(OFF)")) return;
    if (names.some((name) => /^\s*[@$]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 32))) {
      this.limited = true;
      return;
    }
    if (directories.some((directory) => names.some((name) => {
      const path = normalize(`${directory}/${name}`);
      return this.paths.has(path) || extensions(directory).some((ext) => this.paths.has(path + ext));
    }))) return;
    const path = `${directories.join("|")}/${names[0]}`;
    const key = normalize(path);
    if (this.missing.has(key)) return;
    if (this.missing.size >= 200) { this.limited = true; return; }
    this.missing.set(key, { path, source: `${source} · ${kind}/${id}` });
  };

  finish(): MissingResourceReport {
    const report = this.scanner.finish();
    return { missing: [...this.missing.values()].sort((a, b) => a.path.localeCompare(b.path)),
      limited: this.limited || report.reasons.length > 0,
      reasons: report.reasons };
  }
}
