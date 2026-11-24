// A fixed template can also name a sibling directory, for example ../FaceSet/A00.
export function resourcePath(directory: string, name: string): string {
  const parts = [directory];
  for (const component of name.replaceAll("\\", "/").toLowerCase().split("/")) {
    if (component === "..") parts.pop();
    else if (component && component !== ".") parts.push(component.normalize("NFKC"));
  }
  return parts.join("/") + (/[\\/]$/.test(name) || !name ? "/" : "");
}

// Whole-project may-writes. A positive slot is global; a negative slot belongs
// to SELF. Group SELF banks by owning core file (a conservative union of pages).
type Origin =
  | "literal"
  | "itemName"
  | "itemDescription"
  | "decimal"
  | "decimalTail"
  | "music"
  | "copy"
  | "unknown";
type Write = {
  low: number;
  high: number;
  owner: string;
  origin: Origin;
  from?: number;
  sourceOwner: string;
  seeds: Set<string>;
};
type Sink = {
  slot: number;
  kind: "image" | "audio" | "movie";
  directory: string;
  owner: string;
  code: number;
};

export class ManiacStringSources {
  private readonly writes = new Map<string, Write>();
  private readonly reads = new Map<string, Sink>();
  private readonly numeric = new Set<string>();
  private readonly suffix = new Set<string>();
  private external = false;
  private readonly candidatePrefixes = new Set<string>();
  private readonly seedPrefixes = new Map<string, Set<string>>();
  private readonly databaseSeeds = {
    itemName: new Set<string>(),
    itemDescription: new Set<string>(),
    music: new Set<string>(),
  };

  constructor(
    private readonly decoders: readonly TextDecoder[],
    private readonly hasTranslation: boolean,
  ) {}

  private collect(bytes: Uint8Array, into: Set<string>): void {
    if (!this.candidatePrefixes.size) return;
    for (const decoder of this.decoders) {
      let value: string;
      try {
        value = decoder.decode(bytes);
      } catch {
        continue;
      }
      const raw = value.split("\0", 1)[0].replaceAll("\\", "/");
      for (const name of new Set([raw, raw.replace(/[¥₩]/g, "/")])) {
        const leaf = name.split("/").at(-1)!.toLowerCase().normalize("NFKC");
        if (this.candidatePrefixes.has(leaf)) into.add(name);
      }
    }
  }

  databaseField(type: string, id: number, bytes: Uint8Array): void {
    if (type === "Item" && id === 1) this.collect(bytes, this.databaseSeeds.itemName);
    if (type === "Item" && id === 2) this.collect(bytes, this.databaseSeeds.itemDescription);
    if (type === "Music" && id === 1) this.collect(bytes, this.databaseSeeds.music);
  }

  indexCandidate(leaf: string): void {
    // Numeric concatenations may repeat. Index only prefixes of actual files;
    // the LCF visitor can then witness a seed even when no file has its exact name.
    if (leaf.length > 255 || !/\d$/.test(leaf)) return;
    for (let i = leaf.length - 1; i >= 0 && /[-\d]/.test(leaf[i]); i--) {
      this.candidatePrefixes.add(leaf.slice(0, i));
    }
  }

  read(slot: number, kind: Sink["kind"], directory: string, owner: string, code: number): void {
    this.reads.set([slot, kind, directory, owner, code].join("/"), { slot, kind, directory, owner, code });
  }
  invalidate(): void {
    this.external = true;
  }

  private write(
    first: number,
    last: number,
    owner: string,
    origin: Origin,
    from?: number,
    bytes?: Uint8Array,
  ): void {
    const low = Math.min(first, last),
      high = Math.max(first, last);
    const sourceOwner = from !== undefined && from < 0 ? owner : "";
    // Positive targets can never address another global namespace.
    if (low >= 0) owner = "";
    const key = [low, high, owner, origin, from, sourceOwner].join("/");
    let row = this.writes.get(key);
    if (!row) {
      row = { low, high, owner, origin, from, sourceOwner, seeds: new Set() };
      this.writes.set(key, row);
    }
    if (origin === "literal" && bytes) this.collect(bytes, row.seeds);
    if (this.writes.size > 8192) this.invalidate();
  }

  instruction(code: number, p: number[], owner: string, bytes: Uint8Array): void {
    if (this.external) return;
    const a = (i: number) => p[i] | 0;
    if (code === 3030) {
      for (let i = 5; i < p.length && i < 5 + 2 * a(4); i += 2) {
        if (a(i) === 4) this.write(a(i + 1), a(i + 1), owner, "unknown");
        if (a(i) === 5) this.invalidate();
      }
    }
    if (code === 10660 || code === 11510) this.collect(bytes, this.databaseSeeds.music);
    if (code === 3020) {
      const mode = a(0) & 15,
        op = a(3) & 255,
        fn = (a(3) >>> 8) & 255;
      if ([2, 3, 4, 6, 7].includes(op) || op > 10) return;
      if (op >= 5) {
        this.invalidate();
        return;
      } // split/pop/regex also have output ranges
      let origin: Origin = "unknown";
      if (fn === 1 && !(a(3) & 0x20000)) origin = op === 0 ? "decimal" : "decimalTail";
      // Literal assignments and static item names/descriptions already occur
      // in the ordinary LCF string index. Formatting/expansion can change them.
      if (!op && fn === 0 && !(a(0) & 0xff0) && !a(5) && !(a(3) & 0x40000)) origin = "literal";
      if (!op && (fn === 3 || fn === 4) && a(4) === 2 && !(a(6) & 4))
        origin = fn === 3 ? "itemName" : "itemDescription";
      if (!op && fn === 0 && (a(0) & 0xff0) === 16 && !a(5) && !(a(3) & 0x40000)) origin = "copy";
      const from = origin === "copy" ? a(4) : undefined;
      if (mode <= 1) this.write(a(1), mode === 1 ? a(2) : a(1), owner, origin, from, bytes);
      else
        this.write(
          -2147483648,
          a(1) < 0 && (mode === 2 || a(2) < 0) ? 0 : 2147483647,
          owner,
          origin,
          from,
          bytes,
        );
    } else if (code === 3021 && [6, 7, 10].includes(a(1))) {
      this.write(a(2), a(2), owner, a(1) === 10 ? "music" : "unknown");
    } else if (code === 3029) {
      if (a(4)) this.write(a(4), a(4), owner, "unknown");
      if (a(1) & 1 && a(6))
        this.write(a(6) < 0 ? -2147483648 : a(6), a(6) < 0 ? a(6) : 2147483647, owner, "unknown");
    } else if (code === 3001 && a(0) & 0xf0) {
      this.write(a(6), a(6), owner, "unknown");
    } else if (code === 3016 && a(0) === 4 && a(2) === 2) {
      this.invalidate(); // shared-save strings are external inputs
    } else if (code === 3036 && !a(9) && ((a(7) >>> 4) & 15) === 1) {
      this.invalidate(); // writes another environment's string bank
    } else if (code === 12330) {
      const receiver = (a(3) >>> 4) & 15;
      if (receiver === 5) this.write(a(5), a(5), owner, "unknown");
      if (receiver === 6) this.invalidate();
      for (let i = 7, slot = 0; i < p.length && i < 7 + a(6) * 2; i += 2) {
        if ([4, 5, 6].includes(a(i))) {
          const mapCall = a(0) === 1 || a(0) === 2;
          const target = mapCall ? (/\.lmu$/i.test(owner) ? owner : "*") : "common";
          --slot;
          this.write(slot, slot, target, "unknown");
        }
      }
    }
  }

  finish(unresolved: (kind: Sink["kind"], reason: string) => void): void {
    for (const { slot, kind, directory, owner, code } of this.reads.values()) {
      if (this.external || this.reads.size * this.writes.size > 500000) {
        unresolved(kind, owner + " (" + code + ") 字符串写入来源或分析预算未限定");
        continue;
      }
      const prefixes = this.seedPrefixes.get(kind) ?? new Set<string>();
      prefixes.add(directory + "/");
      this.seedPrefixes.set(kind, prefixes);
      const pending = [{ slot, owner }];
      const visited = new Set<string>();
      let unknown = false,
        seeded = false;
      while (pending.length && !unknown) {
        const at = pending.pop()!;
        const key = at.slot < 0 ? at.owner + "/" + at.slot : String(at.slot);
        if (visited.has(key)) continue;
        visited.add(key);
        if (visited.size * this.writes.size > 500000) {
          unknown = true;
          break;
        }
        let matched = false;
        for (const w of this.writes.values()) {
          if (w.low > at.slot || w.high < at.slot) continue;
          if (
            at.slot < 0 &&
            at.owner !== w.owner &&
            w.owner !== "*" &&
            !(w.owner === "common" && /\.ldb$/i.test(at.owner))
          )
            continue;
          matched = true;
          if (w.origin === "copy") {
            pending.push({ slot: w.from!, owner: w.sourceOwner });
            continue;
          }
          seeded = true;
          if (w.origin === "unknown" || (w.origin === "music" && code !== 11510 && code !== 10660))
            unknown = true;
          if (w.origin === "itemName" || w.origin === "itemDescription" || w.origin === "music") {
            for (const seed of this.databaseSeeds[w.origin])
              prefixes.add(resourcePath(directory, seed + "0").slice(0, -1));
            if (this.hasTranslation && w.origin !== "music") unknown = true;
          }
          for (const seed of w.seeds) prefixes.add(resourcePath(directory, seed + "0").slice(0, -1));
          if (w.origin === "decimal") this.numeric.add(kind + ":" + directory);
          if (w.origin === "decimalTail") this.suffix.add(kind);
        }
        if (!matched) unknown = true;
      }
      if (!seeded || unknown) unresolved(kind, owner + " (" + code + ") 字符串槽 " + slot + " 的来源未限定");
    }
  }

  keeps(kind: string, path: string): boolean {
    if (!this.numeric.size && !this.suffix.has(kind)) return false;
    const stem = path.replace(/\.[^./]+$/, "").normalize("NFKC");
    if (!/\d$/.test(stem)) return false;
    const slash = stem.lastIndexOf("/");
    const leaf = stem.slice(slash + 1);
    if (this.numeric.has(kind + ":" + stem.slice(0, slash)) && /^-?\d+$/.test(leaf)) return true;
    if (this.suffix.has(kind)) {
      if (leaf.length > 255) return true;
      for (let i = stem.length - 1; i > slash && /[-\d]/.test(stem[i]); i--) {
        if (this.seedPrefixes.get(kind)?.has(stem.slice(0, i))) return true;
      }
    }
    return false;
  }
}
