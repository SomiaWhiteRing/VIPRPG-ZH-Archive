const header = new TextEncoder().encode("\u000bLcfSaveData");
const compactSaveVersion = 813;

type Field = { id: number; start: number; data: number; end: number };

class Cursor {
  constructor(readonly bytes: Uint8Array, public position: number, readonly end: number) {}

  number(): number {
    let value = 0;
    for (let count = 0; count < 5 && this.position < this.end; count++) {
      const next = this.bytes[this.position++];
      value = value * 128 + (next & 127);
      if (value > 0x7fffffff) break;
      if (!(next & 128)) return value;
    }
    throw new Error("存档字段长度无效。");
  }

  fields(): Field[] {
    const fields: Field[] = [];
    while (this.position < this.end) {
      const start = this.position, id = this.number();
      if (!id) {
        if (this.position !== this.end) throw new Error("存档字段末尾无效。");
        break;
      }
      const length = this.number(), data = this.position;
      if (length > this.end - data) throw new Error("存档字段不完整。");
      this.position += length;
      fields.push({ id, start, data, end: this.position });
    }
    return fields;
  }
}

function find(fields: Field[], id: number): Field | undefined {
  const matches = fields.filter(field => field.id === id);
  if (matches.length > 1) throw new Error("存档升级字段重复。");
  return matches[0];
}

function number(bytes: Uint8Array, field: Field): number {
  const cursor = new Cursor(bytes, field.data, field.end);
  const value = cursor.number();
  if (cursor.position !== field.end) throw new Error("存档数值字段无效。");
  return value;
}

function encoded(value: number): Uint8Array {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
  return Uint8Array.from(bytes);
}

function join(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function field(id: number, value: number): Uint8Array {
  const bytes = encoded(value);
  return join([encoded(id), encoded(bytes.length), bytes]);
}

/** Same 813 conversion as Android LsdSaveUpgrade; preserve all other LCF fields verbatim. */
export function compactLsdSave(bytes: Uint8Array): Uint8Array {
  if (bytes.length < header.length || header.some((byte, index) => bytes[index] !== byte)) return bytes;
  const root = new Cursor(bytes, header.length, bytes.length).fields();
  const extra = find(root, 0xc8), system = find(root, 0x65);
  if (!extra) return bytes;
  const fields = new Cursor(bytes, extra.data, extra.end).fields();
  const version = find(fields, 1), full = find(fields, 0x6f);
  if (!version || !full || find(fields, 0x71)) return bytes;
  const oldVersion = number(bytes, version);
  if (oldVersion <= 0 || oldVersion >= compactSaveVersion) return bytes;
  const length = full.end - full.data;
  if (length % 4 || !system) throw new Error("旧变量表无效。");
  const values = find(new Cursor(bytes, system.data, system.end).fields(), 0x22);
  const prefix = values ? values.end - values.data : 0;
  if (prefix % 4 || prefix > length) throw new Error("旧变量表长度矛盾。");
  for (let i = 0; i < length; i++) {
    if (bytes[full.data + i] !== (values && i < prefix ? bytes[values.data + i] : 0)) {
      throw new Error("旧变量表内容矛盾。");
    }
  }

  const parts = fields.filter(current => current !== full).map(current => current === version
    ? field(1, compactSaveVersion) : bytes.subarray(current.start, current.end));
  parts.push(field(0x71, length / 4));
  if (extra.end > extra.data && bytes[extra.end - 1] === 0
    && (!fields.length || fields[fields.length - 1].end < extra.end)) parts.push(Uint8Array.of(0));
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  return join([bytes.subarray(0, extra.start), encoded(0xc8), encoded(size), ...parts, bytes.subarray(extra.end)]);
}
