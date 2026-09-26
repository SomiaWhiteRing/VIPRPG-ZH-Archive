const crcTable = buildCrcTable();

export function crc32(bytes: Uint8Array): number {
  const checksum = new Crc32();
  checksum.update(bytes);
  return checksum.digest();
}

export class Crc32 {
  private value = 0xffffffff;

  update(bytes: Uint8Array): void {
    let value = this.value;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    this.value = value;
  }

  digest(): number {
    return (this.value ^ 0xffffffff) >>> 0;
  }
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}
