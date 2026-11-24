import { directNumberWrites } from "./maniac-script-assets.mjs";

// Numeric filenames read a global variable (even when the event runs in SELF).
// A range can prune only when every incoming definition is covered. Separately
// keep finite assignment evidence for auditing games with unresolved aliases.
export type NumberOwner = { type: string; id: number; parent: number; trigger: number; source: string };
type Span = readonly [number, number];
type Test = { id: number; range: Span; inverse: boolean };
type Formula =
  | { test: Test }
  | { value: Span }
  | { slot: number }
  | { op: number; lhs: Formula; rhs: Formula }
  | null;
type Write = {
  dest: Span;
  rhs: Formula;
  operation: number;
  indirect: boolean;
  address?: Formula;
  addressFact?: Fact;
  visited?: boolean;
  certified?: Span;
  resultFact?: Fact;
  resultSeen?: boolean;
  verifiedResult?: Span;
  inputFact?: Fact;
  inputSeen?: boolean;
  verifiedInput?: Span;
};
type Fact = { value: Span; deps: Set<number> };
type State = Map<number, Fact>;
export type PictureNumber = {
  slot: number;
  owner: NumberOwner;
  offset: number;
  local?: Fact;
  bounded?: Span[];
  evidence: Span[];
  comparisons: number[];
  increments: number[];
  basis: string;
  observed: boolean;
  // Source evidence only: a recurring call may be interrupted or take another path.
  callerValues?: number[];
  counterCalls?: { event: number; range: Span }[];
};
type Step = {
  processed?: boolean;
  code: number;
  depth: number;
  p: number[];
  writes: Write[];
  use?: PictureNumber;
  test?: Test;
  condition?: Formula;
  barrier: boolean;
};
type Context = {
  owner: NumberOwner;
  writes: Map<string, Write>;
  calls: Set<number>;
  callMap: boolean;
  background: boolean;
  resets?: { slot: number; threshold: number; start: number }[];
};
const MIN = -2147483648,
  MAX = 2147483647;
const anywhere: Span = [MIN, MAX];
const constant = (v: number): Formula => ({ value: [v, v] });
const ref = (slot: number): Formula => ({ slot });
const binary = (op: number, lhs: Formula, rhs: Formula): Formula => ({ op, lhs, rhs });
const hull = (a: Span, b: Span): Span => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
const intersection = (a: Span, b: Span): Span | undefined => {
  const lo = Math.max(a[0], b[0]),
    hi = Math.min(a[1], b[1]);
  return lo <= hi ? [lo, hi] : undefined;
};
const unknownWrite: Write = { dest: anywhere, rhs: null, operation: 0, indirect: true };
const includes = (a: Span, n: number) => a[0] <= n && n <= a[1];

function arithmetic(op: number, a: Span | undefined, b: Span | undefined): Span | undefined {
  if (!b) return;
  if (op >= 58 && op <= 63 && a) {
    const [x, y] = a,
      [v, w] = b;
    const always = [x === y && x === v && v === w, x >= w, y <= v, x > w, y < v, y < v || x > w][op - 58];
    const never = [y < v || x > w, y < v, x > w, y <= v, x >= w, x === y && x === v && v === w][op - 58];
    return always ? [1, 1] : never ? [0, 0] : [0, 1];
  }
  if (op === 5 && b[0] === b[1]) {
    const limit = Math.max(0, Math.abs(b[0]) - 1);
    if (!a || a[0] !== a[1]) return [a && a[0] >= 0 ? 0 : -limit, a && a[1] <= 0 ? 0 : limit];
  }
  if (!a) return;
  if (op === 16) return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
  if (op === 17) return [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  if ((op === 4 || op === 5) && b[0] !== b[1]) return;
  const values: number[] = [];
  for (const x of a)
    for (const y of b) {
      switch (op) {
        case 1:
          values.push(x + y);
          break;
        case 2:
          values.push(x - y);
          break;
        case 3:
          values.push(x * y);
          break;
        case 4:
          values.push(Math.trunc(x / (y || 1)));
          break;
        case 5:
          values.push(x % (y || 1));
          break;
        default:
          return;
      }
    }
  // Avoid assuming a specific executable's overflow/clamp settings.
  return [
    Math.max(MIN, Math.min(999999, Math.min(...values))),
    Math.min(MAX, Math.max(-999999, Math.max(...values))),
  ];
}

function evaluate(f: Formula, lookup: (id: number) => Span | undefined): Span | undefined {
  if (!f) return;
  if ("value" in f) return f.value;
  if ("slot" in f) return lookup(f.slot);
  if ("test" in f) return [0, 1];
  return arithmetic(f.op, evaluate(f.lhs, lookup), evaluate(f.rhs, lookup));
}

function intervals(items: Span[]): Span[] {
  const sorted = items.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    result: Span[] = [];
  for (const item of sorted) {
    if (item[0] > item[1]) continue;
    const last = result.at(-1);
    if (last && item[0] <= last[1] + 1) result[result.length - 1] = [last[0], Math.max(last[1], item[1])];
    else result.push(item);
  }
  return result;
}

// Read a pure Maniac prefix expression. Unrecognised/mutating nodes cannot
// serve as proof that the expression leaves other numeric slots untouched.
function expression(p: number[], start: number, words: number): { pure: boolean; f: Formula } {
  let cursor = 0,
    pure = true;
  const end = Math.min(words, p.length - start) * 4;
  const byte = () => {
    if (cursor >= end) {
      pure = false;
      return 0;
    }
    const i = cursor++;
    return (p[start + (i >>> 2)] >>> ((i % 4) * 8)) & 255;
  };
  const compare = (a: Formula, b: Formula, k: number): Formula => {
    if (!a || !b || !("value" in b) || b.value[0] !== b.value[1]) return null;
    const v = b.value[0];
    if ("test" in a && (k === 58 || k === 63) && (v === 0 || v === 1))
      return { test: { ...a.test, inverse: a.test.inverse !== ((k === 58) === (v === 0)) } };
    if (!("slot" in a)) return null;
    const spans: Span[] = [
      [v, v],
      [v, MAX],
      [MIN, v],
      [v + 1, MAX],
      [MIN, v - 1],
      [v, v],
    ];
    return { test: { id: a.slot, range: spans[k - 58], inverse: k === 63 } };
  };
  const node = (depth: number): Formula => {
    if (!pure || depth > 32 || cursor > 1024) {
      pure = false;
      return null;
    }
    const k = byte();
    if (k >= 1 && k <= 6) {
      const size = [1, 2, 4][(k - 1) % 3];
      let n = 0;
      for (let j = 0; j < size; j++) n |= byte() << (8 * j);
      return constant(n);
    }
    if ([8, 9, 11, 12, 13, 14, 16, 17, 20, 21, 22, 23, 24, 25, 26].includes(k)) {
      const v = node(depth + 1);
      if (k === 8) {
        const id = evaluate(v, () => undefined);
        if (id && id[0] === id[1]) return ref(id[0]);
      }
      return null;
    }
    if (k >= 48 && k <= 66) {
      const a = node(depth + 1),
        b = node(depth + 1);
      if (k === 66) return null;
      return k <= 52
        ? binary(k - 47, a, b)
        : k >= 58 && k <= 63
          ? (compare(a, b, k) ?? binary(k, a, b))
          : null;
    }
    if (k === 72) {
      node(depth + 1);
      node(depth + 1);
      node(depth + 1);
      return null;
    }
    if (k === 78) {
      const arities = [2, 2, 2, 2, 2, 2, 1, 2, 2, 3, 3, 3, 2, 2, 1, 3, 3, 3, 3, 4, 2, 2, 2];
      const selector = byte();
      const count = byte();
      if (selector >= arities.length || count !== arities[selector]) {
        pure = false;
        return null;
      }
      const args = Array.from({ length: count }, () => node(depth + 1));
      const [a, b, c] = args;
      // Clamp's value can be unknown while the two literal limits still bound
      // the result. Native computes min(max(value, low), high).
      if (
        selector === 15 &&
        b &&
        "value" in b &&
        c &&
        "value" in c &&
        b.value[0] === b.value[1] &&
        c.value[0] === c.value[1]
      )
        return { value: [Math.min(b.value[0], c.value[0]), c.value[0]] };
      if (selector === 18 && a && "slot" in a && b && "value" in b && c && "value" in c)
        return { test: { id: a.slot, range: [b.value[0], c.value[1]], inverse: false } };
      return null;
    }
    pure = false;
    return null;
  };
  const f = node(0);
  return { pure, f };
}

// These operations do not write numeric slots. Calls and scene transitions
// additionally invalidate local reaching definitions.
const ordinary = new Set([
  10, 1006, 1007, 1008, 1009, 5001, 5002, 5003, 5004, 5005, 10110, 10120, 10130, 10140, 10210, 10230, 10310,
  10320, 10330, 10410, 10420, 10430, 10440, 10450, 10460, 10470, 10480, 10490, 10610, 10620, 10630, 10640,
  10650, 10660, 10670, 10680, 10690, 10710, 10720, 10730, 10740, 10810, 10830, 10840, 10850, 10860, 10870,
  11010, 11020, 11030, 11040, 11050, 11060, 11070, 11110, 11120, 11130, 11210, 11310, 11320, 11330, 11340,
  11350, 11410, 11510, 11520, 11530, 11540, 11550, 11560, 11710, 11720, 11740, 11750, 11810, 11820, 11830,
  11840, 11910, 11930, 11950, 11960, 12110, 12120, 12220, 12310, 12320, 12410, 12420, 12510, 13110, 13120,
  13130, 13150, 13210, 13260, 13410, 20110, 20140, 20141, 20710, 20711, 20712, 20713, 20720, 20721, 20722,
  20730, 20731, 20732, 22010, 22011, 22410, 23310, 23311, 3003, 3006, 3007, 3015, 3018, 3026, 3032,
]);
const boundaries = new Set([
  5001, 10140, 10710, 10720, 10730, 10810, 10830, 11910, 11950, 12110, 12120, 12310, 12320, 20140, 20141,
  20710, 20711, 20712, 20713, 20720, 20721, 20722, 20730, 20731, 20732, 23310, 23311, 3003,
]);

export class ManiacNumberFlow {
  private readonly callInputs = new Map<string, Set<number>>();
  noteCallInput(event: number, slot: number, value: number): void {
    const key = event + "/" + slot,
      values = this.callInputs.get(key) ?? new Set<number>();
    if (values.size < 256) values.add(value);
    this.callInputs.set(key, values);
  }
  private readonly events: Context[] = [];
  private readonly emptyPages = new Set<string>();
  readonly uses: PictureNumber[] = [];
  private external = false;
  disabled = false;
  private writeCount = 0;
  private retainedSteps = 0;
  abandon(): void {
    this.disabled = true;
    for (const u of this.uses) {
      u.bounded = undefined;
      u.basis = "超过编号分析预算";
    }
    this.events.length = 0;
    this.deferred.length = 0;
  }
  register(ctx: Context, steps: number): void {
    this.writeCount += ctx.writes.size;
    this.retainedSteps += steps;
    if (
      this.writeCount > 100000 ||
      this.retainedSteps > 160000 ||
      this.events.length + this.emptyPages.size > 80000
    ) {
      this.abandon();
      return;
    }
    if (ctx.writes.size || ctx.calls.size || ctx.callMap || steps || ctx.owner.type === "CommonEvent")
      this.events.push(ctx);
    else if (ctx.owner.type === "EventPage")
      this.emptyPages.add([ctx.owner.source, ctx.owner.parent, ctx.owner.id].join("/"));
  }
  private globals = new Map<number, Span>();
  range(id: number): Span | undefined {
    return this.globals.get(id);
  }
  private readonly deferred: NumberList[] = [];
  defer(list: NumberList): void {
    this.deferred.push(list);
  }
  readonly counts = new Map<number, Set<number>>();
  readonly guards = new Map<number, Set<number>>();
  noteGuard(slot: number, value: number): void {
    const values = this.guards.get(slot) ?? new Set<number>();
    values.add(value);
    this.guards.set(slot, values);
  }
  private resolveCall?: (owner: NumberOwner, code: number, p: number[]) => Write[];
  calleeWrites(owner: NumberOwner, code: number, p: number[]): Write[] {
    return this.resolveCall?.(owner, code, p) ?? [unknownWrite];
  }
  invalidate(): void {
    this.external = true;
  }

  list(owner: NumberOwner): NumberList | undefined {
    if (this.disabled) return;
    const context: Context = {
      owner,
      writes: new Map(),
      calls: new Set(),
      callMap: false,
      background: false,
    };
    return new NumberList(this, context);
  }

  finish(): void {
    if (this.disabled || !this.uses.length) return;
    const byId = new Map<number, Context[]>(),
      background: Context[] = [];
    for (const e of this.events) {
      if (e.owner.type === "CommonEvent") {
        const group = byId.get(e.owner.id) ?? [];
        group.push(e);
        byId.set(e.owner.id, group);
      }
      if (e.owner.type === "TroopPage" || [4, 7].includes(e.owner.trigger)) {
        e.background = true;
        background.push(e);
      }
    }
    for (const u of this.uses) u.counterCalls = undefined;
    for (const list of this.deferred) list.linkCounterCalls(byId);
    let anyBackground = this.external;
    for (let i = 0; i < background.length; i++) {
      const e = background[i];
      if (e.callMap) anyBackground = true;
      for (const id of e.calls) {
        if (id <= 0) {
          anyBackground = true;
          continue;
        }
        for (const callee of byId.get(id) ?? [])
          if (!callee.background) {
            callee.background = true;
            background.push(callee);
          }
      }
    }
    const all = new Map<string, Write>();
    const mapPages = new Map<string, Context[]>(),
      callCache = new Map<string, Write[]>();
    for (const e of this.events)
      if (e.owner.type === "EventPage") {
        const key = [e.owner.source, e.owner.parent, e.owner.id].join("/");
        const pages = mapPages.get(key) ?? [];
        pages.push(e);
        mapPages.set(key, pages);
      }
    const writes = this.events.flatMap((e) => [...e.writes.values()]);
    const destination = (w: Write, env: Map<number, Span>): Span => {
      const r = w.address && evaluate(w.address, (k) => env.get(k));
      return r ? (intersection(w.certified ?? w.dest, r) ?? [1, 0]) : (w.certified ?? w.dest);
    };
    // Infer an inductive envelope for address operands and picture slots.
    // A round reads the preceding envelope, starting with fresh-game zero.
    // Unknown imports/writers widen the affected slots; untracked operands are top.
    const infer = (): Map<number, Span> => {
      if (this.external || writes.length > 12000) return new Map();
      const ids = new Set<number>(this.uses.map((u) => u.slot));
      function reads(f?: Formula) {
        if (!f) return;
        if ("slot" in f) {
          if (f.slot > 0) ids.add(f.slot);
        } else if ("op" in f) {
          reads(f.lhs);
          reads(f.rhs);
        }
      }
      for (const w of writes) reads(w.address);
      // A dependency omitted for budget reasons always reads as unknown.
      for (let n = 0; n < 4 && ids.size <= 96; n++) {
        const before = new Set(ids);
        for (const w of writes)
          if (!w.indirect && [...before].some((id) => includes(w.dest, id))) reads(w.rhs);
        if (ids.size === before.size) break;
      }
      if (ids.size > 192) return new Map();
      let g = new Map(
        [...ids].map((id) => [
          id,
          writes.some((w) => !w.indirect && includes(w.dest, id)) ? ([0, 0] as Span) : anywhere,
        ]),
      );
      const growth = new Map<number, number>();
      let steps = 0;
      for (let round = 0; round < 48; round++) {
        const out = new Map(g);
        for (const w of writes) {
          const dst = destination(w, g);
          for (const id of ids) {
            if (!includes(dst, id)) continue;
            if (++steps > 1500000) return new Map();
            const rhs = evaluate(w.rhs, (k) => g.get(k));
            const assigned =
              w.verifiedResult ??
              (w.operation ? arithmetic(w.operation, w.verifiedInput ?? g.get(id), rhs) : rhs) ??
              anywhere;
            out.set(id, hull(out.get(id)!, assigned));
          }
        }
        let changed = false;
        for (const [id, r] of out) {
          const old = g.get(id)!;
          if (old[0] === r[0] && old[1] === r[1]) continue;
          changed = true;
          const count = (growth.get(id) ?? 0) + 1;
          growth.set(id, count);
          if (count > 12) out.set(id, [r[0] < old[0] ? MIN : r[0], r[1] > old[1] ? MAX : r[1]]);
        }
        if (!changed) return out;
        g = out;
      }
      return new Map();
    };
    this.resolveCall = (owner, code, p) => {
      const mode = code === 1005 ? 0 : p[0] | 0,
        id = code === 1005 ? p[0] | 0 : (p[1] | 0) + (p[4] | 0);
      if (code !== 1005 && p[3] & 15) return [unknownWrite];
      const key = mode === 0 ? "c/" + id : mode === 1 ? [owner.source, id, p[2] | 0].join("/") : "?";
      const cached = callCache.get(key);
      if (cached) return cached;
      const queue = mode === 0 ? [...(byId.get(id) ?? [])] : mode === 1 ? [...(mapPages.get(key) ?? [])] : [];
      if (!queue.length) return mode === 1 && this.emptyPages.has(key) ? [] : [unknownWrite];
      const seen = new Set<Context>(),
        targets: Write[] = [];
      for (let i = 0; i < queue.length; i++) {
        const e = queue[i];
        if (seen.has(e)) continue;
        seen.add(e);
        if (e.callMap || e.calls.has(-1) || seen.size > 128) {
          targets.push(unknownWrite);
          break;
        }
        for (const w of e.writes.values()) targets.push({ ...w, dest: destination(w, this.globals) });
        for (const next of e.calls) for (const child of byId.get(next) ?? []) queue.push(child);
      }
      callCache.set(key, targets);
      return targets;
    };
    const called = new Set(this.events.flatMap((e) => [...e.calls]));
    const mapCalls = this.events.some((e) => e.callMap);
    const refresh = () => {
      callCache.clear();
      for (const l of this.deferred) l.analyze();
    };
    for (const w of writes) {
      w.certified = undefined;
      w.verifiedInput = undefined;
      w.verifiedResult = undefined;
    }
    this.globals = infer();
    const spans = (events: Context[]) =>
      intervals(events.flatMap((e) => [...e.writes.values()].map((w) => destination(w, this.globals))));
    // Tighten from conservative footprints only. A locally inferred bound is
    // promoted once all its dependencies are stable under competing writers.
    // Stopping early can only leave more candidates protected.
    for (let round = 0; round < 3; round++) {
      refresh();
      if (this.external || writes.length > 12000) break;
      const bgWrites = anyBackground ? [anywhere] : spans(background),
        others = new Map<Context, Span[]>();
      let changed = false;
      for (const e of this.events) {
        let peers = bgWrites;
        for (const w of e.writes.values()) {
          if (!w.addressFact && !w.resultFact && !w.inputFact) continue;
          if (e.background && !anyBackground) {
            if (!others.has(e)) {
              const reentrant =
                e.owner.type === "CommonEvent" ? called.has(e.owner.id) || called.has(-1) : mapCalls;
              others.set(e, spans(this.events.filter((other) => other !== e || reentrant)));
            }
            peers = others.get(e)!;
          }
          const tighten = (prev: Span | undefined, f?: Fact) => {
            if (!f || [...f.deps].some((id) => peers.some((r) => includes(r, id)))) return prev;
            const bound = prev ? intersection(prev, f.value) : f.value;
            if (!bound) return prev;
            if (!prev || bound[0] !== prev[0] || bound[1] !== prev[1]) changed = true;
            return bound;
          };
          w.certified = tighten(w.certified, w.addressFact);
          w.verifiedResult = tighten(w.verifiedResult, w.resultFact);
          w.verifiedInput = tighten(w.verifiedInput, w.inputFact);
        }
      }
      if (!changed) break;
      this.globals = infer();
    }
    const competing = anyBackground ? [anywhere] : spans(background);

    for (const e of this.events)
      for (const w of e.writes.values()) {
        const dest = destination(w, this.globals);
        const effect = {
          dest,
          rhs: w.verifiedResult ? { value: w.verifiedResult } : w.rhs,
          operation: w.verifiedResult ? 0 : w.operation,
          indirect: w.indirect && !w.certified,
        };
        all.set(JSON.stringify(effect), effect);
      }
    const allWrites = [...all.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, w]) => w);
    const cache = new Map<number, { ranges: Span[]; open: boolean }>();
    let budget = 0;
    const solve = (id: number, parents: Set<number>): { ranges: Span[]; open: boolean } => {
      const have = cache.get(id);
      if (have) return have;
      if (parents.has(id) || parents.size > 24 || budget > 1500000) return { ranges: [], open: true };
      const next = new Set(parents).add(id),
        values: Span[] = [];
      let open = this.external || id <= 0,
        found = false;
      for (const w of allWrites) {
        if (!includes(w.dest, id)) continue;
        found = true;
        if (++budget > 1500000) {
          open = true;
          break;
        }
        if (w.indirect) {
          open = true;
          continue;
        } // an unresolved address is not positive evidence for this slot
        if (w.operation !== 0) {
          open = true;
          continue;
        }
        if (!w.rhs) {
          open = true;
          continue;
        }
        if ("slot" in w.rhs) {
          const src = solve(w.rhs.slot, next);
          open ||= src.open;
          values.push(...src.ranges);
          continue;
        }
        const r = evaluate(w.rhs, (k) => {
          const src = solve(k, next);
          if (src.open) return;
          return src.ranges.reduce<Span>((a, b) => hull(a, b), [0, 0]);
        });
        if (r) values.push(r);
        else open = true;
      }
      const result = { ranges: intervals(values), open: open || !found };
      if (!result.open) cache.set(id, result);
      return result;
    };
    // Resolve roots in stable order even if core-pack entries arrive reversed.
    const roots = new Map<number, { ranges: Span[]; open: boolean }>();
    for (const id of [...new Set(this.uses.map((u) => u.slot))].sort((a, b) => a - b))
      roots.set(id, solve(id, new Set()));
    const supportCache = new Map<number, [number[], number[]]>();
    const contexts = new Map(this.events.map((e) => [e.owner, e]));
    for (const u of this.uses) {
      u.bounded = undefined;
      // Direct calls do not enumerate variable-dispatched or resumed entries.
      // Keep this as positive evidence only, even at the first command.
      if (u.owner.type === "CommonEvent" && u.offset === 0)
        u.callerValues = [...(this.callInputs.get(u.owner.id + "/" + u.slot) ?? [])].sort((a, b) => a - b);
      u.basis = "写入或入口范围未限定";
      const domain = roots.get(u.slot)!;
      u.evidence = domain.ranges;
      let support = supportCache.get(u.slot);
      if (!support) {
        const visited = new Set<number>(),
          queue = [u.slot],
          tests = new Set<number>(),
          counts = new Set<number>();
        for (let i = 0; i < queue.length && visited.size < 64; i++) {
          const id = queue[i];
          if (visited.has(id)) continue;
          visited.add(id);
          for (const n of this.guards.get(id) ?? []) tests.add(n);
          for (const n of this.counts.get(id) ?? []) counts.add(n);
          for (const w of allWrites)
            if (!w.indirect && includes(w.dest, id) && !w.operation && w.rhs && "slot" in w.rhs)
              queue.push(w.rhs.slot);
        }
        support = [[...tests].sort((a, b) => a - b), [...counts].sort((a, b) => a - b)];
        supportCache.set(u.slot, support);
      }
      [u.comparisons, u.increments] = support;
      if (!domain.open && budget <= 1500000) {
        u.bounded = intervals([[0, 0], ...domain.ranges]);
        u.basis = "全游戏写入";
      }
      const envelope = this.globals.get(u.slot);
      if (envelope && (envelope[0] !== MIN || envelope[1] !== MAX)) {
        u.bounded = u.bounded
          ? u.bounded.flatMap((r) => {
              const v = intersection(r, envelope);
              return v ? [v] : [];
            })
          : [envelope];
        u.basis = "全游戏写入不变范围";
      }
      const ctx = contexts.get(u.owner)!;
      if (
        u.local &&
        !this.external &&
        !ctx.background &&
        ![...u.local.deps].some((v) => competing.some((w) => includes(w, v)))
      ) {
        const range = u.local.value;
        u.bounded = u.bounded
          ? u.bounded.flatMap((v) => {
              const both = intersection(v, range);
              return both ? [both] : [];
            })
          : [range];
        u.basis = "事件赋值、循环或分支";
      }
    }
  }
}

export class NumberList {
  private readonly steps: Step[] = [];
  private previousLiteral?: { slot: number; value: number };
  private budget = 0;
  private malformed = false;
  constructor(
    private readonly project: ManiacNumberFlow,
    private readonly context: Context,
  ) {}

  add(
    code: number,
    depth: number,
    p: number[],
    offset: number,
    bytes?: Uint8Array,
  ): PictureNumber | undefined {
    if (this.project.disabled) return;
    if (this.steps.length > 35000 || this.context.writes.size > 35000) {
      this.project.abandon();
      this.steps.length = 0;
      this.context.writes.clear();
      return;
    }
    const n = (i: number) => p[i] | 0;
    if (code === 12330 && !n(0) && !(n(3) & 15) && this.previousLiteral)
      this.project.noteCallInput(n(1) + n(4), this.previousLiteral.slot, this.previousLiteral.value);
    this.previousLiteral =
      code === 10220 && n(0) === 0 && n(1) > 0 && !n(3) && !n(4) ? { slot: n(1), value: n(5) } : undefined;
    const writes: Write[] = [];
    const write = (dest: Span, rhs: Formula = null, operation = 0, indirect = false, address?: Formula) => {
      const w: Write = { dest, rhs, operation, indirect, address };
      const key = JSON.stringify(w);
      const prior = this.context.writes.get(key);
      if (!prior) this.context.writes.set(key, w);
      writes.push(prior ?? w);
    };
    const any = () => write(anywhere, null, 0, true);
    const operand = (mode: number, arg: number): Formula =>
      mode === 0 ? constant(arg) : mode === 1 ? ref(arg) : null;
    let barrier = boundaries.has(code),
      test: Test | undefined,
      condition: Formula = null;
    if (code === 10220) {
      const target = n(0);
      let dest: Span = anywhere,
        indirect = false,
        address: Formula = null;
      if (target === 0) dest = [n(1), n(1)];
      else if (target === 1)
        dest = n(1) < 0 === n(2) < 0 ? [Math.min(n(1), n(2)), Math.max(n(1), n(2))] : [n(1), n(1)];
      else if (target === 2 || target === 3) {
        indirect = true;
        if (target === 2 && n(1) > 0) address = ref(n(1));
        if (n(1) < 0 && (target === 2 || n(2) < 0)) dest = [MIN, 0];
      } else {
        const at = n(1),
          v = expression(p, at + 1, p[at] | 0);
        if (!v.pure) any();
        if (target === 4) address = v.f;
        const r = evaluate(v.f, () => undefined);
        if (target === 4 && r && r[0] === r[1]) dest = r;
        else {
          indirect = true;
          if (target >= 5) dest = [MIN, 0];
        }
      }
      let f: Formula = null;
      switch (n(4)) {
        case 0:
          f = constant(n(5));
          break;
        case 1:
          f = ref(n(5));
          break;
        case 3:
          if (!n(7)) f = { value: [Math.min(n(5), n(6)), Math.max(n(5), n(6))] };
          break;
        case 16:
        case 17:
          f = binary(n(4), operand(n(7) & 15, n(5)), operand((n(7) >>> 4) & 15, n(6)));
          break;
        case 20: {
          const flags = n(10);
          if (!(flags & 0xff00)) f = { value: [Math.min(n(8), n(9)), Math.max(n(8), n(9))] };
          break;
        }
        case 19:
          if (n(5) >= 1 && n(5) <= 5)
            f = binary(n(5), operand(n(8) & 15, n(6)), operand((n(8) >>> 4) & 15, n(7)));
          break;
        case 21: {
          const expr = expression(p, 6, n(5));
          if (!expr.pure) any();
          f = expr.f;
          break;
        }
      }
      write(dest, f, n(3), indirect, address);
    } else if (code === 12210 || code === 22210) {
      if (n(4) !== 0 && n(0) !== 0) {
        let f: Formula = null;
        if (n(0) === 1 && !n(1) && n(2) > 0) f = { value: [0, n(2) - 1] };
        if ([2, 3].includes(n(0)) && !n(1) && !(n(0) === 2 && n(3) === MAX) && !(n(0) === 3 && n(3) === MIN))
          f = { value: [Math.min(n(2), n(3)), Math.max(n(2), n(3))] };
        write([n(4), n(4)], f);
        if (n(0) >= 6) write([n(4) + 1, n(4) + 1]);
      }
    } else if (code === 12010 || code === 13310) {
      if (code === 12010 && n(0) === 1 && n(1) > 0 && !n(2) && !n(4)) this.project.noteGuard(n(1), n(3));
      if (n(0) === 16) {
        const e = expression(p, 6, p.length - 6);
        if (!e.pure) any();
        condition = e.f;
        if (e.f && "test" in e.f) test = e.f.test;
      }
    } else if (code === 12330 || code === 1005) {
      barrier = true;
      if (code === 1005) this.context.calls.add(n(0));
      else if (n(0) === 0 && !(n(3) & 15)) this.context.calls.add(n(1) + n(4));
      else if ([1, 2].includes(n(0))) this.context.callMap = true;
      else this.context.calls.add(-1);
      if (code === 12330 && ((n(3) >>> 4) & 15) === 2) write([n(5), n(5)]);
      if (code === 12330 && ((n(3) >>> 4) & 15) === 3) any();
    } else if (code === 3001) {
      for (let i = 2; i <= 5; i++) write([n(i), n(i)]);
    } else if (code === 3002) {
      if (n(2)) write([n(3), n(3)], { value: [0, 1] });
      barrier = true;
    } else if (code === 3014) {
      const mode = n(0),
        base = n(1);
      if (base > 0 && mode >= 0 && mode < 5)
        write([base, base + (mode <= 1 ? 49 : mode <= 2 ? 0 : 15)], {
          value: mode === 4 ? [-128, 127] : [0, 1],
        });
    } else if (code === 3016) {
      if (n(0) === 4 && n(2) === 1) {
        if (n(1) !== 0) any();
        else if (n(5) > 0) write([Math.min(n(3), n(3) + n(5) - 1), Math.max(n(3), n(3) + n(5) - 1)]);
      }
    } else if (code === 10150) {
      write([n(1), n(1)]);
    } else if (code === 10910 || code === 10920) {
      write([n(3), n(3)]);
    } else if (code === 10820) {
      for (let i = 0; i < 3; i++) write([n(i), n(i)]);
    } else if (code === 10500) {
      if (n(6)) write([n(7), n(7)]);
    } else if (code === 11610) {
      write([n(0), n(0)]);
      if (n(8) && n(7)) write([n(7), n(7)]);
    } else if (code === 3005) {
      for (let i = 0; i < 3; i++) write([n(i), n(i)]);
    } else if (code === 3008 && n(0) === 0 && n(1) === 0) {
      for (let i = 4; i < 8; i++) write([n(i), n(i)]);
    } else if (code === 3021 && n(1) === 4 && !(n(0) & 15)) {
      write([n(2), n(2) + 4]);
    } else if (code === 3020) {
      if (![0, 1, 6, 7].includes(n(3) & 255)) any();
    } else if (code === 3030 && bytes && n(0) === 0 && n(4) === 0) {
      this.project.invalidate(); // Shared JS state still prevents whole-project numeric exclusions.
      const targets = directNumberWrites(bytes);
      if (!targets) {
        any();
        barrier = true;
      } else for (const id of targets) write([id, id]);
    } else if (!ordinary.has(code) || code === 3005) {
      any();
      barrier = true;
      // Scripts, generated commands and callbacks can set up another interpreter.
      if ([3019, 3029, 3030, 3031].includes(code)) this.project.invalidate();
    }

    let use: PictureNumber | undefined;
    if (code === 11110 && n(19) > 0) {
      use = {
        slot: n(19),
        owner: this.context.owner,
        offset,
        evidence: [],
        comparisons: [],
        increments: [],
        basis: "写入或入口范围未限定",
        observed: false,
      };
      this.project.uses.push(use);
    }
    // Non-writing, straight-line commands are invisible to numeric state.
    if (writes.length || barrier || use || [12010, 22010, 22011, 12210, 12220, 22210].includes(code)) {
      this.steps.push({ code, p, depth, writes, use, barrier, test, condition });
    }
    return use;
  }

  // Match a loop's literal numeric argument with a callee's SELF threshold.
  // This supplies a reason to retain matching numbers, never a pruning bound.
  linkCounterCalls(byId: Map<number, Context[]>): void {
    const stack: { uses: PictureNumber[]; begin: number }[] = [];
    for (let i = 0; i < this.steps.length; i++) {
      const s = this.steps[i],
        p = s.p;
      if (s.code === 12210) stack.push({ uses: [], begin: i });
      if (s.code === 22210) {
        stack.pop();
        continue;
      }
      const loop = stack.at(-1);
      if (!loop) continue;
      if (s.use) loop.uses.push(s.use);
      if (s.code !== 12330 || p[0] !== 0 || p[3] & 15) continue;
      const id = (p[1] | 0) + (p[4] | 0),
        args: (number | undefined)[] = [];
      for (let j = 0; j < (p[6] | 0) && 7 + j * 2 < p.length; j++) {
        const type = p[7 + j * 2] | 0;
        if (type < 4 || type > 9) args.push(type === 1 ? p[8 + j * 2] | 0 : undefined);
      }
      for (const target of byId.get(id) ?? [])
        for (const reset of target.resets ?? []) {
          const limit = args[-reset.threshold - 1];
          if (limit === undefined || limit <= reset.start) continue;
          const begin = this.steps[loop.begin];
          if (begin.p[0] === 1 && !(begin.p[1] | 0) && (begin.p[2] | 0) < limit - reset.start) continue;
          const init = this.steps[loop.begin - 1];
          if (
            !init ||
            init.code !== 10220 ||
            init.depth !== begin.depth ||
            init.p[0] !== 0 ||
            init.p[1] !== reset.slot ||
            init.p[3] !== 0 ||
            init.p[4] !== 0 ||
            init.p[5] !== reset.start
          )
            continue;
          for (const u of loop.uses)
            if (u.slot === reset.slot)
              (u.counterCalls ??= []).push({ event: id, range: [reset.start, limit - 1] });
        }
    }
  }
  finish(): void {
    if (this.project.disabled) return;
    if (this.context.owner.type === "CommonEvent") {
      for (let i = 2; i < this.steps.length; i++) {
        const inc = this.steps[i - 2],
          check = this.steps[i - 1],
          reset = this.steps[i];
        if (
          inc.code === 10220 &&
          inc.p[0] === 0 &&
          inc.p[1] > 0 &&
          inc.p[3] === 1 &&
          inc.p[4] === 0 &&
          inc.p[5] === 1 &&
          check.code === 12010 &&
          check.depth === inc.depth &&
          check.p[0] === 1 &&
          check.p[1] === inc.p[1] &&
          check.p[2] === 1 &&
          (check.p[3] | 0) < 0 &&
          check.p[4] === 1 &&
          reset.code === 10220 &&
          reset.depth === check.depth + 1 &&
          reset.p[0] === 0 &&
          reset.p[1] === inc.p[1] &&
          reset.p[3] === 0 &&
          reset.p[4] === 0
        ) {
          (this.context.resets ??= []).push({
            slot: inc.p[1],
            threshold: check.p[3] | 0,
            start: reset.p[5] | 0,
          });
        }
      }
    }
    // Record explicit successive increments starting from a hypothetical zero.
    // This is a trace hint only: re-entry and saved values preclude using it to prune.
    const deltas = new Map<number, number>();
    for (const s of this.steps) {
      if (s.barrier || [12010, 22010, 22011, 12210, 22210, 12220].includes(s.code)) deltas.clear();
      for (const w of s.writes) {
        if (
          !w.indirect &&
          w.dest[0] === w.dest[1] &&
          (w.operation === 1 || w.operation === 2) &&
          w.rhs &&
          "value" in w.rhs &&
          w.rhs.value[0] === w.rhs.value[1]
        ) {
          const id = w.dest[0],
            n = (deltas.get(id) ?? 0) + (w.operation === 1 ? 1 : -1) * w.rhs.value[0];
          deltas.set(id, n);
          const values = this.project.counts.get(id) ?? new Set<number>();
          if (values.size < 256) values.add(n);
          this.project.counts.set(id, values);
        } else for (const id of deltas.keys()) if (includes(w.dest, id)) deltas.delete(id);
      }
    }
    const needed = this.steps.some((s) => s.use || s.writes.some((w) => w.address));
    this.project.register(this.context, needed ? this.steps.length : 0);
    if (needed && !this.project.disabled) this.project.defer(this);
  }
  analyze(): void {
    if (
      !this.steps.some(
        (s) =>
          s.use ||
          s.writes.some((w) => w.address || w.operation !== 0) ||
          (s.code === 22210 && s.writes.length),
      )
    )
      return;
    this.budget = 0;
    this.malformed = false;
    for (const step of this.steps) {
      step.processed = false;
      if (step.use) {
        step.use.observed = false;
        step.use.local = undefined;
      }
      for (const w of step.writes) {
        w.addressFact = undefined;
        w.visited = false;
        w.resultFact = undefined;
        w.resultSeen = false;
        w.inputFact = undefined;
        w.inputSeen = false;
      }
    }
    const seq = this.steps,
      uses = seq.flatMap((s) => (s.use ? [s.use] : []));
    const next = new Map<number, number>(),
      stack: number[] = [];
    for (let i = 0; i < seq.length; i++) {
      const c = seq[i].code;
      if (c === 12010 || c === 12210) stack.push(i);
      if (c === 22010 || c === 22011 || c === 22210) {
        const start = stack.pop();
        if (
          start === undefined ||
          seq[start].depth !== seq[i].depth ||
          (c === 22210
            ? seq[start].code !== 12210
            : c === 22010
              ? seq[start].code !== 12010
              : ![12010, 22010].includes(seq[start].code))
        ) {
          this.malformed = true;
          break;
        }
        next.set(start, i);
        if (c === 22010) stack.push(i);
      }
    }
    if (stack.length || this.malformed) {
      for (const s of seq) if (s.code === 22210) for (const w of s.writes) w.rhs = null;
      return;
    }
    for (const [a, b] of next)
      if (
        seq[a].code === 12210 &&
        (seq[a].p.length !== seq[b].p.length || seq[a].p.some((v, k) => v !== seq[b].p[k]))
      )
        for (const w of seq[b].writes) w.rhs = null;
    const controls = new Set<number>();
    const merge = (a: State | null, b: State | null): State | null => {
      if (!a) return b;
      if (!b) return a;
      const out: State = new Map();
      for (const [k, x] of a) {
        const y = b.get(k);
        if (y) out.set(k, { value: hull(x.value, y.value), deps: new Set([...x.deps, ...y.deps]) });
      }
      return out;
    };
    const branch = (s: Step, state: State, yes: boolean): State | null => {
      const p = s.p;
      if (s.test) {
        const { id, range, inverse } = s.test;
        const prior = state.get(id),
          base = prior?.value ?? this.project.range(id) ?? anywhere;
        const on = yes !== inverse;
        const clipped = on
          ? intersection(base, range)
          : range[0] <= base[0]
            ? intersection(base, [range[1] + 1, MAX])
            : range[1] >= base[1]
              ? intersection(base, [MIN, range[0] - 1])
              : base;
        if (!clipped) {
          controls.add(id);
          for (const d of prior?.deps ?? []) controls.add(d);
          return null;
        }
        const out = new Map(state);
        out.set(id, { value: clipped, deps: new Set([id, ...(prior?.deps ?? [])]) });
        return out;
      }
      if (s.condition && !s.test) {
        const deps = new Set<number>();
        const r = evaluate(s.condition, (id) => {
          const v = state.get(id);
          if (v) {
            deps.add(id);
            for (const d of v.deps) deps.add(d);
          }
          return v?.value ?? this.project.range(id);
        });
        if (r && (yes ? r[0] === 0 && r[1] === 0 : r[0] > 0 || r[1] < 0)) {
          for (const id of deps) controls.add(id);
          return null;
        }
      }
      if (p[0] !== 1 || !(p[1] > 0) || p[2] !== 0) return new Map(state);
      const id = p[1],
        v = p[3] | 0,
        cmp = yes ? p[4] : [5, 4, 3, 2, 1, 0][p[4]];
      const prior = state.get(id),
        base = prior?.value ?? this.project.range(id) ?? anywhere;
      const ranges: Span[] = [
        [v, v],
        [v, MAX],
        [MIN, v],
        [v + 1, MAX],
        [MIN, v - 1],
      ];
      const r =
        cmp === 5
          ? ((base[0] === v ? [v + 1, base[1]] : base[1] === v ? [base[0], v - 1] : base) as Span)
          : (ranges[cmp] ?? anywhere);
      const value = intersection(r, base);
      if (!value) {
        controls.add(id);
        for (const d of prior?.deps ?? []) controls.add(d);
        return null;
      }
      const out = new Map(state);
      out.set(id, { value, deps: new Set([id, ...(prior?.deps ?? [])]) });
      return out;
    };
    const apply = (s: Step, live: State) => {
      s.processed = true;
      if (s.code === 12330 || s.code === 1005) {
        const targetWrites = this.project.calleeWrites(this.context.owner, s.code, s.p);
        for (const [id, old] of live) {
          let joined = old.value;
          for (const w of targetWrites)
            if (includes(w.dest, id)) {
              const output =
                w.verifiedResult ??
                (w.operation === 0 ? evaluate(w.rhs, (k) => this.project.range(k)) : undefined);
              if (!output) {
                live.delete(id);
                break;
              }
              joined = hull(joined, output);
            }
          if (live.has(id)) live.set(id, { value: joined, deps: old.deps });
        }
      } else if (s.barrier && ![12110, 12120, 10140, 20140, 20141].includes(s.code)) live.clear();
      const before = new Map(live);
      for (const w of s.writes) {
        let dest = w.dest;
        if (w.address) {
          const deps = new Set<number>();
          const bound = evaluate(w.address, (k) => {
            const f = before.get(k);
            if (f) deps.add(k);
            for (const d of f?.deps ?? []) deps.add(d);
            return f?.value ?? this.project.range(k);
          });
          if (!w.visited) w.addressFact = bound ? { value: bound, deps } : undefined;
          else if (!bound || !w.addressFact) w.addressFact = undefined;
          else
            w.addressFact = {
              value: hull(w.addressFact.value, bound),
              deps: new Set([...w.addressFact.deps, ...deps]),
            };
          w.visited = true;
          if (bound) {
            dest = bound;
            for (const d of deps) controls.add(d);
          }
        }
        for (const id of live.keys()) if (includes(dest, id)) live.delete(id);
        if ((w.indirect && dest[0] !== dest[1]) || dest[1] - dest[0] > 64) continue;
        for (let id = Math.max(1, dest[0]); id <= dest[1]; id++) {
          const deps = new Set<number>();
          if (w.operation && dest[0] === dest[1]) {
            const input = before.get(id);
            if (!w.inputSeen) w.inputFact = input;
            else if (input && w.inputFact)
              w.inputFact = {
                value: hull(input.value, w.inputFact.value),
                deps: new Set([...input.deps, ...w.inputFact.deps, id]),
              };
            else w.inputFact = undefined;
            w.inputSeen = true;
          }
          const value = evaluate(w.operation ? binary(w.operation, ref(id), w.rhs) : w.rhs, (k) => {
            const old = before.get(k);
            if (old) deps.add(k);
            for (const d of old?.deps ?? []) deps.add(d);
            return old?.value ?? this.project.range(k);
          });
          if (dest[0] === dest[1] && (w.operation || (w.rhs && !("value" in w.rhs)))) {
            if (!w.resultSeen) w.resultFact = value ? { value, deps } : undefined;
            else if (!value || !w.resultFact) w.resultFact = undefined;
            else
              w.resultFact = {
                value: hull(w.resultFact.value, value),
                deps: new Set([...w.resultFact.deps, ...deps]),
              };
            w.resultSeen = true;
          }
          if (value) live.set(id, { value, deps: new Set([...deps, id]) });
        }
      }
      if (s.use) {
        const u = s.use,
          f = live.get(u.slot);
        if (!u.observed) u.local = f;
        else if (!f || !u.local) u.local = undefined;
        else u.local = { value: hull(u.local.value, f.value), deps: new Set([...u.local.deps, ...f.deps]) };
        u.observed = true;
      }
    };
    const run = (
      first: number,
      end: number,
      initial: State | null,
      level: number,
    ): { live: State | null; escape: State | null } => {
      let live = initial,
        escape: State | null = null;
      if (level > 32) {
        this.malformed = true;
        return { live: null, escape: null };
      }
      for (let i = first; live && i < end && !this.malformed; i++) {
        if (++this.budget > 120000) {
          this.malformed = true;
          break;
        }
        const s = seq[i],
          p = s.p;
        if (s.code === 12010) {
          const split = next.get(i)!,
            hasElse = seq[split].code === 22010,
            close = hasElse ? next.get(split)! : split;
          const left = run(i + 1, split, branch(s, live, true), level + 1);
          const right = run(hasElse ? split + 1 : close, close, branch(s, live, false), level + 1);
          live = merge(left.live, right.live);
          escape = merge(escape, merge(left.escape, right.escape));
          i = close;
          continue;
        }
        if (s.code === 12210) {
          const close = next.get(i)!,
            tail = seq[close].p;
          const paired = p.length === tail.length && p.every((v, k) => v === tail[k]);
          let iterations = -1,
            start = 0,
            step = 1;
          if (paired && (p[1] | 0) === 0) {
            if (p[0] === 1 && (p[2] | 0) !== MIN) iterations = Math.max(0, p[2] | 0);
            if ((p[0] === 2 && (p[3] | 0) !== MAX) || (p[0] === 3 && (p[3] | 0) !== MIN)) {
              step = p[0] === 2 ? 1 : -1;
              start = p[2] | 0;
              iterations = Math.max(0, ((p[3] | 0) - start) * step + 1);
            }
          }
          let joined: State | null = null;
          // Summarize simple counted array walks without unrolling N copies
          // at each CFG visit. Verify all alias ranges against every induction
          // slot before using its start + iteration * stride invariant.
          if (iterations > 8 && iterations <= 10000 && !(p[4] | 0)) {
            const body = seq.slice(i + 1, close),
              stride = new Map<number, number>();
            let simple = !body.some((s) => s.barrier || [12210, 22210, 12220].includes(s.code));
            for (const s of body)
              for (const w of s.writes) {
                if (
                  s.depth !== seq[i].depth + 1 ||
                  w.indirect ||
                  !(w.operation === 1 || w.operation === 2) ||
                  !w.rhs ||
                  !("value" in w.rhs) ||
                  w.rhs.value[0] !== w.rhs.value[1] ||
                  w.dest[1] - w.dest[0] > 8
                )
                  continue;
                for (let id = Math.max(1, w.dest[0]); id <= w.dest[1]; id++)
                  if (live.has(id)) {
                    if (stride.has(id)) simple = false;
                    stride.set(id, (w.operation === 1 ? 1 : -1) * w.rhs.value[0]);
                  }
              }
            const head = new Map(live),
              exit = new Map(live),
              envelope = new Map<number, Span>();
            for (const [id, inc] of stride) {
              const f = live.get(id)!,
                last = arithmetic(1, f.value, [inc * (iterations - 1), inc * (iterations - 1)])!;
              const after = arithmetic(1, f.value, [inc * iterations, inc * iterations])!;
              if (
                Math.max(
                  Math.abs(after[0]),
                  Math.abs(after[1]),
                  Math.abs(f.value[0]),
                  Math.abs(f.value[1]),
                ) >= 999999
              )
                simple = false;
              head.set(id, { value: hull(f.value, last), deps: f.deps });
              exit.set(id, { value: after, deps: f.deps });
              envelope.set(id, hull(head.get(id)!.value, after));
            }
            if (simple && stride.size) {
              for (const s of body)
                for (const w of s.writes) {
                  const address =
                    w.address && evaluate(w.address, (id) => envelope.get(id) ?? this.project.range(id));
                  const dest = address ?? w.dest;
                  for (const id of stride.keys())
                    if (includes(dest, id)) {
                      if (
                        w.indirect ||
                        s.depth !== seq[i].depth + 1 ||
                        ![1, 2].includes(w.operation) ||
                        !w.rhs ||
                        !("value" in w.rhs) ||
                        w.rhs.value[0] !== w.rhs.value[1] ||
                        w.dest[1] - w.dest[0] > 8
                      )
                        simple = false;
                    }
                  for (const id of live.keys())
                    if (!stride.has(id) && includes(dest, id)) {
                      head.delete(id);
                      exit.delete(id);
                    }
                }
              if (simple) {
                for (const id of stride.keys()) {
                  controls.add(id);
                  for (const d of live.get(id)!.deps) controls.add(d);
                }
                run(i + 1, close, head, level + 1);
                live = exit;
                i = close;
                continue;
              }
            }
          }
          if (iterations >= 0 && iterations <= 128) {
            for (let n = 0; live && n < iterations && !this.malformed; n++) {
              if ((p[4] | 0) > 0) {
                const x = start + n * step;
                live.set(p[4], { value: [x, x], deps: new Set([p[4]]) });
              }
              const result = run(i + 1, close, live, level + 1);
              live = result.live;
              joined = merge(joined, result.escape);
            }
          } else if (paired && !(p[0] | 0)) {
            for (let n = 0; live && n < 128 && !this.malformed; n++) {
              const result = run(i + 1, close, live, level + 1);
              live = result.live;
              joined = merge(joined, result.escape);
              if (live && !live.size) break;
            }
            if (live) {
              run(i + 1, close, new Map(), level + 1);
              joined = new Map();
            }
            live = null;
          } else {
            run(i + 1, close, new Map(), level + 1);
            live = new Map();
          }
          live = merge(live, joined);
          i = close;
          continue;
        }
        if (s.code === 12220) {
          escape = merge(escape, live);
          live = null;
          continue;
        }
        apply(s, live);
      }
      return { live, escape };
    };
    if (
      seq.some(
        (s) =>
          s.code === 12120 ||
          s.code === 10140 ||
          [
            20140, 20141, 20710, 20711, 20712, 20713, 20720, 20721, 20722, 20730, 20731, 20732, 23310, 23311,
          ].includes(s.code) ||
          (s.code === 12210 && ![1, 2, 3].includes(s.p[0])),
      )
    ) {
      // Explicit edges for label jumps. A literal-count inner loop with no label
      // entry can still be evaluated as a unit from each incoming state.
      const labels = new Map<number, number>();
      seq.forEach((s, i) => {
        if (s.code === 12110 && !labels.has(s.p[0] | 0)) labels.set(s.p[0] | 0, i);
      });
      const state = new Map<string, State>(),
        queue: { key: string; pc: number }[] = [],
        queued = new Set<string>(),
        updates = new Map<string, number>();
      const pointerSlots = new Set(
        seq.flatMap((s) =>
          s.writes.flatMap((w) => (w.address && "slot" in w.address ? [w.address.slot] : [])),
        ),
      );
      const selectorCounts = new Map<number, number>();
      for (let j = 0; j + 1 < seq.length; j++) {
        const s = seq[j],
          w = seq[j + 1].writes[0];
        if (
          s.code === 12010 &&
          s.p[0] === 1 &&
          s.p[2] === 0 &&
          s.p[4] === 0 &&
          w &&
          pointerSlots.has(w.dest[0]) &&
          !w.indirect &&
          !w.operation &&
          w.rhs &&
          "value" in w.rhs
        )
          selectorCounts.set(s.p[1], (selectorCounts.get(s.p[1]) ?? 0) + 1);
      }
      const selector = [...selectorCounts]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .find((e) => e[1] >= 3)?.[0];
      const partitions = new Map<number, Set<number>>();
      // Keep alternatives separate at lookup tables such as "if V==n: pointer=base".
      // Imprecise or excessive alternatives share an ordinary joined state.
      const enqueue = (pc: number, incoming: State, key: string) => {
        if (!incoming || pc >= seq.length) return;
        const old = state.get(key);
        const merged = old ? merge(old, incoming)! : new Map(incoming);
        if (old) {
          let changed = old.size !== merged.size;
          for (const [id, v] of merged) {
            const prev = old.get(id)!;
            if (
              (updates.get(key) ?? 0) > 24 &&
              (prev.value[0] !== v.value[0] || prev.value[1] !== v.value[1])
            ) {
              v.value = [
                v.value[0] < prev.value[0] ? MIN : v.value[0],
                v.value[1] > prev.value[1] ? MAX : v.value[1],
              ];
            }
            if (
              prev.value[0] !== v.value[0] ||
              prev.value[1] !== v.value[1] ||
              prev.deps.size !== v.deps.size
            )
              changed = true;
          }
          if (!changed) return;
        }
        state.set(key, merged);
        updates.set(key, (updates.get(key) ?? 0) + 1);
        if (!queued.has(key)) {
          queued.add(key);
          queue.push({ pc, key });
        }
      };
      const submit = (pc: number, incoming: State | null) => {
        if (!incoming || pc >= seq.length) return;
        const selected = selector === undefined ? undefined : incoming.get(selector);
        if (selector !== undefined && selected && selected.value[1] - selected.value[0] <= 12) {
          const keys = partitions.get(pc) ?? new Set<number>();
          partitions.set(pc, keys);
          if (keys.size < 48) {
            for (let n = selected.value[0]; n <= selected.value[1]; n++) {
              keys.add(n);
              const one = new Map(incoming);
              one.set(selector, { value: [n, n], deps: selected.deps });
              enqueue(pc, one, pc + "/" + n);
            }
            return;
          }
        }
        enqueue(pc, incoming, pc + "/*");
      };
      const choices = new Map<number, number[]>(),
        optionEnds = new Map<number, number>();
      for (let i = 0; i < seq.length; i++)
        if (seq[i].code === 10140) {
          const options: number[] = [];
          for (let j = i + 1; j < seq.length; j++) {
            if (seq[j].depth < seq[i].depth) break;
            if (seq[j].depth !== seq[i].depth) continue;
            if (seq[j].code === 20140) options.push(j);
            else if (seq[j].code === 20141) {
              choices.set(i, [...options.map((n) => n + 1), j + 1]);
              optionEnds.set(j, j + 1);
              for (const k of options) optionEnds.set(k, j + 1);
              break;
            } else break;
          }
        }
      submit(0, new Map());
      // Choice and battle-result handlers can enter an arm without traversing
      // the preceding arm, and the engine can jump to the corresponding end.
      for (let i = 0; i < seq.length; i++)
        if (
          !optionEnds.has(i) &&
          [
            20140, 20141, 20710, 20711, 20712, 20713, 20720, 20721, 20722, 20730, 20731, 20732, 23310, 23311,
          ].includes(seq[i].code)
        )
          submit(i, new Map());
      for (let q = 0; q < queue.length && !this.malformed; q++) {
        if (++this.budget > 120000) {
          this.malformed = true;
          break;
        }
        const { pc: i, key } = queue[q];
        queued.delete(key);
        const s = seq[i],
          live = new Map(state.get(key)!);
        if (s.code === 10140 && choices.has(i)) for (const target of choices.get(i)!) submit(target, live);
        else if (s.code === 20140 && optionEnds.has(i)) submit(optionEnds.get(i)!, live);
        else if (s.code === 12010) {
          const cut = next.get(i)!;
          submit(i + 1, branch(s, live, true));
          submit(cut + 1, branch(s, live, false));
        } else if (s.code === 22010) submit(next.get(i)! + 1, live);
        else if (s.code === 12120) {
          if (s.p.length > 1) {
            this.malformed = true;
            break;
          }
          submit((labels.get(s.p[0] | 0) ?? i) + 1, live);
        } else if (s.code === 12210) {
          const end = next.get(i)!;
          if (
            ![1, 2, 3].includes(s.p[0]) ||
            seq
              .slice(i + 1, end)
              .some(
                (x) =>
                  x.code === 12110 ||
                  x.code === 12120 ||
                  [
                    10140, 20140, 20141, 20710, 20711, 20712, 20713, 20720, 20721, 20722, 20730, 20731, 20732,
                    23310, 23311,
                  ].includes(x.code),
              )
          ) {
            apply(s, live);
            submit(i + 1, live);
            if (s.p[0]) submit(end + 1, live);
          } else submit(end + 1, run(i, end + 1, live, 0).live);
        } else if (s.code === 22210 || s.code === 12220) {
          const begin = [...next.entries()]
            .filter(([b, e]) => seq[b].code === 12210 && b < i && e >= i)
            .sort((a, b) => b[0] - a[0])[0];
          if (!begin) {
            this.malformed = true;
            break;
          }
          if (s.code === 22210) {
            // An EndLoop only updates the exported counter on a continuing iteration.
            const continuing = new Map(live);
            apply(s, continuing);
            submit(begin[0] + 1, continuing);
            if (s.p[0]) submit(begin[1] + 1, live);
          } else submit(begin[1] + 1, live);
        } else {
          apply(s, live);
          submit(i + 1, live);
        }
      }
    } else run(0, seq.length, new Map(), 0);
    for (const step of this.steps)
      if (!step.processed)
        for (const w of step.writes) {
          w.addressFact = undefined;
          w.inputFact = undefined;
          w.resultFact = undefined;
        }
    for (const w of this.context.writes.values()) {
      if (this.malformed) {
        w.addressFact = undefined;
        w.resultFact = undefined;
        w.inputFact = undefined;
      } else
        for (const d of controls) {
          w.inputFact?.deps.add(d);
          w.addressFact?.deps.add(d);
          w.resultFact?.deps.add(d);
        }
    }
    for (const u of uses) {
      if (this.malformed) u.local = undefined;
      else if (u.local) for (const id of controls) u.local.deps.add(id);
    }
  }
}
