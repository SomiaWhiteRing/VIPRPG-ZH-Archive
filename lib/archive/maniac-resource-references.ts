import { ManiacNumberFlow, type PictureNumber } from "./maniac-number-flow";
import { analyzeManiacScripts } from "./maniac-script-assets.mjs";
import { ManiacStringSources, resourcePath } from "./maniac-string-sources";

// Fields from liblcf's fields_easyrpg.csv and the RPGRewriter Maniac LDB reader.
export const additionalFields: Record<string, Record<number, string>> = {
  Database: { 33: "array:StringVariable" }, StringVariable: { 1: "string" },
  Enemy: { 15: "integer" }, Item: { 30: "integer" }, State: { 40: "integer" },
  System: { 124: "integer", 126: "integer", 127: "integer" },
  Terms: Object.fromEntries([161, 162, 163, 164, 165, 166, 171, 172,
    ...Array.from({ length: 20 }, (_, i) => 200 + i)].map(id => [id, "string"])),
};

// These instructions operate on IDs, in-memory objects, save slots, strings or
// output files. Their consumers which open game media are handled separately.
const noMedia = new Set([
  3002, 3003, 3016, // save, load, shared save
  3005, 3013, 3014, 3018, 3021, 3029, 3032, 3033, 3036, // input, state, options, console
  3009, 3010, 3011, 3012, 3015, // battle state and map tiles
  3008, 3025, 3026, // inspect, edit or export an existing picture
]);

const imageFile = /\.(?:png|bmp|xyz|jpe?g|gif)$/i;
const audioFile = /\.(?:wav|mid|midi|mp3|ogg|oga|flac|opus|wma)$/i;
const movieFile = /\.(?:avi|mpg|mpeg)$/i;
type Kind = "image" | "audio" | "movie";
const extensions = { image: imageFile, audio: audioFile, movie: movieFile };
const folderKind = (folder: string): Kind => folder === "movie" ? "movie"
  : folder === "sound" || folder === "music" ? "audio" : "image";

const mediaCommands: Record<number, [string, number, number, number]> = {
  // Directory, mode word index, filename nibble and maximum audited length.
  // Missing words read as zero. Other bits select playback and display options.
  10130: ["faceset", 3, 0, 10], 10630: ["charset", 3, 1, 5], 10640: ["faceset", 2, 1, 4],
  10650: ["charset", 2, -1, 2], 10660: ["music", 5, 0, 7], 10670: ["sound", 4, 0, 6],
  10680: ["system", 2, 0, 4], 10710: ["backdrop", 10, -1, 10], 11510: ["music", 4, 0, 6],
  11550: ["sound", 3, 0, 5], 11560: ["movie", 5, -1, 5], 11720: ["panorama", 6, 0, 8],
  13210: ["backdrop", 0, 0, 2],
};

export class ManiacResourceReferences {
  readonly numbers = new ManiacNumberFlow();
  private readonly numberUses = new Map<string, Set<PictureNumber | undefined>>();
  private readonly kinds = new Set<Kind>();
  private readonly numberPrefixes = new Map<string, Set<number>>();
  private readonly exactPictures = new Set<string>();
  private readonly variablePrefixWidths = new Set<number>();

  constructor(private readonly record: (bytes: Uint8Array) => void,
    private readonly reason: (message: string) => void, private readonly preserveAll: (message: string) => void,
    private readonly decoders: readonly TextDecoder[], hasTranslation: boolean) {
    this.strings = new ManiacStringSources(decoders, hasTranslation);
  }

  private unknownName(kind: Kind, source: string): void {
    // FileFinder accepts ../ in a resource name. An unknown image operand can
    // select a FaceSet from Picture, but cannot decode an audio file.
    this.kinds.add(kind);
    this.reason(source);
  }

  private numericPictures(base: string, width: number, use?: PictureNumber): void {
    // Append a digit before normalization so a partial "." or ".." stays in the name.
    const prefix = resourcePath("picture", base + "0").slice(0, -1);
    const widths = this.numberPrefixes.get(prefix) ?? new Set<number>();
    widths.add(width);
    this.numberPrefixes.set(prefix, widths);
    const key = width + "/" + prefix;
    const uses = this.numberUses.get(key) ?? new Set();
    uses.add(use);
    this.numberUses.set(key, uses);
  }

  keeps(path: string): boolean {
    for (const kind of ["image", "audio", "movie"] as const) {
      if (extensions[kind].test(path) && (this.kinds.has(kind) || this.strings.keeps(kind, path))) return true;
    }
    if (!imageFile.test(path)) return false;
    if (!this.numberPrefixes.size && !this.exactPictures.size && !this.variablePrefixWidths.size && !this.jsNumberPrefixes.size) return false;
    path = path.normalize("NFKC");
    for (const name of [path, path.replace(/\.[^./]*$/, "")]) {
      if (this.exactPictures.has(name)) return true;
      for (const prefix of this.jsNumberPrefixes) {
        const tail = name.slice(prefix.length);
        if (name.startsWith(prefix) && (String(Number(tail)).toLowerCase() === tail || tail === "infinity" || tail === "-infinity")) return true;
      }
      // A prefix may itself end in digits. Try each signed int32 suffix.
      for (let i = name.length - 1; i >= Math.max(0, name.length - 10) && /[0-9]/.test(name[i]); i--) {
        const suffix = name.slice(i);
        for (const negative of [false, true]) {
          if (negative && name[i - 1] !== "-") continue;
          const prefix = name.slice(0, negative ? i - 1 : i);
          const widths = this.numberPrefixes.get(prefix);
          if (!widths && !this.variablePrefixWidths.size) continue;
          const value = Number(suffix);
          if ((negative && value === 0) || value > (negative ? 2147483648 : 2147483647)) continue;
          for (const width of [...(widths ?? []), ...this.variablePrefixWidths]) {
            if (!this.variablePrefixWidths.has(width)) {
              const uses = this.numberUses.get(width + "/" + prefix);
              const signed = negative ? -value : value;
              if (uses && ![...uses].some(u => !u?.bounded || u.bounded.some(([lo,hi]) => lo <= signed && signed <= hi))) continue;
            }
            // Native and Kai differ on the sign's padding in some versions.
            if (String(value).padStart(width, "0") === suffix ||
                (negative && [width - 1, width - 2].some(w => String(value).padStart(w, "0") === suffix))) return true;
          }
        }
      }
    }
    return false;
  }

  readonly strings: ManiacStringSources;
  private readonly scripts = new Map<string, string>();
  private readonly jsNumberPrefixes = new Set<string>();
  private scriptBytes = 0;

  javascript(lines: Uint8Array[], mode: number, source: string): void {
    if (mode !== 0 || this.scriptBytes > 512 * 1024) {
      this.preserveAll(source + " (3030) 脚本来源或大小未限定");
      return;
    }
    let decoded = false;
    for (const decoder of this.decoders) {
      let script: string;
      try { script = lines.map(line => decoder.decode(line)).join("\n"); } catch { continue; }
      decoded = true;
      if (this.scripts.has(script)) continue;
      this.scriptBytes += script.length;
      if (this.scriptBytes > 512 * 1024) {
        this.preserveAll(source + " (3030) 脚本超过分析预算");
        return;
      }
      this.scripts.set(script, source);
    }
    if (!decoded) this.preserveAll(source + " (3030) 脚本编码未知");
  }

  finish(): void {
    this.numbers.finish();
    if (!this.scripts.size) {
      this.strings.finish((kind, why) => this.unknownName(kind, why));
      return;
    }
    const result = analyzeManiacScripts(this.scripts);
    if (result.error) { this.preserveAll(result.error); return; }
    if (result.writesStrings) this.strings.invalidate();
    this.strings.finish((kind, why) => this.unknownName(kind, why));
    for (const value of result.effects ?? []) {
      if (value === "*") {
        this.unknownName("image", "JavaScript 图片路径包含未限定的文本");
        continue;
      }
      const name = value.slice(1).split("\0", 1)[0];
      for (const path of new Set([name, name.replace(/[¥₩]/g, "/")])) {
        if (value.startsWith("%") && !value.includes("\0")) {
          this.jsNumberPrefixes.add(resourcePath("picture", path + "0").slice(0, -1));
        } else this.exactPictures.add(resourcePath("picture", path));
      }
    }
  }

  command(code: number, bytes: Uint8Array, p: number[], source: string, numericUse?: PictureNumber): boolean {
    this.strings.instruction(code, p, source, bytes);
    if (noMedia.has(code)) return true;
    const where = source + " (" + code + ")";
    if (code === 11110) {
      if (p.length > 34) {
        this.unknownName("image", where + " 图片文件名参数布局未知");
      } else if ((p[17] >>> 8) & 15) {
        if ((p[19] | 0) > 0 && (p[18] | 0) > 0) {
          this.variablePrefixWidths.add(Math.min(p[18], 9));
          this.reason(where + " 图片路径取自变量，按数字后缀保护");
        } else if (((p[17] >>> 8) & 15) === 1 && !(p[19] | 0)) {
          this.strings.read(p[30] | 0, "image", "picture", source, code);
        } else this.unknownName("image", where + " 图片文件名取自字符串变量");
      } else if ((p[19] | 0) > 0) {
        const digits = p[18] | 0;
        let decoded = false;
        for (const decoder of this.decoders) {
          let name: string;
          try { name = decoder.decode(bytes).split("\0", 1)[0]; } catch { continue; }
          decoded = true;
          if (digits <= 0 && name) {
            if (name.length >= 16) this.unknownName("image", where + " 图片名使用未定长替换");
            else this.exactPictures.add(resourcePath("picture", name + name));
          } else {
            const base = digits > 0 ? name.slice(0, Math.max(0, name.length - digits)) : "";
            this.numericPictures(base, Math.max(1, Math.min(digits, 9)), numericUse);
          }
        }
        if (!decoded) this.unknownName("image", where + " 图片模板编码未知");
      }
      return true;
    }
    if (code === 3007) {
      // Three control-byte-delimited operands: body, System skin, font.
      // A string-variable body can itself inject a delimiter before the skin.
      const boundary = bytes.subarray(1).findIndex(byte => byte <= 3);
      if (!bytes.length) return true;
      if (bytes[0] !== 1 || (boundary >= 0 && bytes[boundary + 1] >= 2)) {
        this.unknownName("image", where + " 文字图片的系统图可能取自字符串变量");
      } else if (boundary >= 0 && bytes[boundary + 1] === 1) {
        const skin = bytes.subarray(boundary + 2);
        const end = skin.findIndex(byte => byte <= 3);
        this.record(end < 0 ? skin : skin.subarray(0, end));
      }
      return true;
    }
    if (code === 3001) {
      if (p.slice(8, 12).some(value => value !== 0) || p[7]) {
        this.unknownName("image", where + " 从存档读取脸图");
      }
      return true;
    }
    if (code === 3020) {
      // FromFile also accepts complete game-relative paths via Text/../.
      // Other string operations only matter when a media command consumes their result.
      if ((p[3] & 255) <= 1 && ((p[3] >>> 8) & 255) === 12) {
        if (((p[0] >>> 4) & 15) || (p[3] & 0x40000)) this.preserveAll(where + " 文本读取路径取自变量或展开表达式");
        else this.record(bytes);
      }
      return true;
    }
    if (code === 3027) {
      const mode = (p[0] >>> 16) & 15;
      if (mode) {
        for (const [action, kind] of [[7, "image"], [8, "audio"]] as const) {
          if (!(p[0] & 15) && p[1] !== action) continue;
          if (mode === 1) this.strings.read(p[5] | 0, kind, action === 7 ? "charset" : "sound", source, code);
          else this.unknownName(kind, where + " 移动路线文件名间接取自字符串变量");
        }
      }
      return true;
    }
    if (code === 3019) {
      const target = p[1];
      if (!(p[0] & 15)) {
        if (target === 3019) return true;
        // Inline arguments have a mode nibble each; only replay literal operands.
        if (((p[0] >>> 4) & 0xfff) === 3 && (p[3] | 0) >= 0 && p[3] <= 34) {
          const args = Array.from({ length: p[3] }, (_, i) => p[5 + i] ?? 0);
          const literal = (i: number) => !((p[(p[2] | 0) + (i >> 2)] >>> ((i % 4) * 4)) & 15);
          // The SELF copy's value kind alone determines which bank it can write.
          if (target === 3036 && literal(7) && ((args[7] >>> 4) & 15) !== 1) return true;
          if (args.every((_, i) => literal(i)) &&
              this.command(target, bytes, args, source)) return true;
        }
        if ([3001, 3016, 3020, 3021, 3029, 3030, 3036, 12330].includes(target)) this.strings.invalidate();
        if (noMedia.has(target)) return true;
        const media = mediaCommands[target];
        if (media || target === 11110 || target === 3007 || target === 3001) {
          this.unknownName(media ? folderKind(media[0]) : "image", where + " 动态生成指令 " + target);
          return true;
        }
      }
      this.preserveAll(where + " 无法限定生成指令的素材范围");
      return true;
    }
    if (code === 3030) {
      this.javascript([bytes], p[0] ?? 0, source);
      return true;
    }
    if (code === 3031) {
      this.preserveAll(where + " JavaScript 续行缺少主指令");
      return true;
    }
    const media = mediaCommands[code];
    if (!media) return false;
    const [folder, flags, nibble, maxLength] = media;
    const mode = nibble < 0 ? 0 : (p[flags] >>> (4 * nibble)) & 15;
    if (mode === 1 && p.length <= maxLength) {
      this.strings.read(p[flags + 1] | 0, folderKind(folder), folder, source, code);
    } else if (p.length > maxLength || mode) {
      this.unknownName(folderKind(folder), where + " 扩展资源参数可能指定动态文件名");
    }
    return true;
  }
}
