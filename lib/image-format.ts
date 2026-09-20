export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// Enough for the signatures and primary headers below, including BMP.
export const IMAGE_HEADER_BYTES = 64;

export class ImageValidationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function unsupportedImage(): never {
  throw new ImageValidationError(
    400,
    "无法识别图片格式或尺寸，请选择 PNG、JPEG、WebP、GIF 或 BMP。",
  );
}

function matches(bytes: Uint8Array, offset: number, signature: string) {
  return offset + signature.length <= bytes.length &&
    [...signature].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

// Identify raster content independently of filenames and untrusted MIME hints.
// This is not an integrity check or a guarantee that a decoder can display it.
export function identifyImage(bytes: Uint8Array) {
  let format: "png" | "gif" | "webp" | "jpeg" | "bmp";
  if (bytes.length >= 33 && matches(bytes, 0, "\x89PNG\r\n\x1a\n") &&
    matches(bytes, 8, "\x00\x00\x00\x0dIHDR")) {
    format = "png";
  } else if (bytes.length >= 13 &&
    (matches(bytes, 0, "GIF87a") || matches(bytes, 0, "GIF89a"))) {
    format = "gif";
  } else if (bytes.length >= 30 && matches(bytes, 0, "RIFF") &&
    matches(bytes, 8, "WEBPVP8X")) {
    format = "webp";
  } else if (bytes.length >= 30 && matches(bytes, 0, "RIFF") &&
    matches(bytes, 8, "WEBPVP8 ") && matches(bytes, 23, "\x9d\x01\x2a")) {
    format = "webp";
  } else if (bytes.length >= 25 && matches(bytes, 0, "RIFF") &&
    matches(bytes, 8, "WEBPVP8L") && bytes[20] === 0x2f) {
    format = "webp";
  } else if (bytes.length >= 4 && matches(bytes, 0, "\xff\xd8\xff") && bytes[3] !== 0) {
    format = "jpeg";
  } else if (bytes.length >= 54 && matches(bytes, 0, "BM")) {
    format = "bmp";
  } else {
    return unsupportedImage();
  }
  return { format, contentType: `image/${format}` };
}

// EXIF is optional metadata. Ignore malformed orientation entries safely.
function exifOrientation(view: DataView, start: number, end: number) {
  if (start + 8 > end) return 1;
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return 1;
  const le = order === 0x4949;
  if (view.getUint16(start + 2, le) !== 42) return 1;
  const ifd = start + view.getUint32(start + 4, le);
  if (ifd < start + 8 || ifd + 2 > end) return 1;
  const count = view.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + 12 * i;
    if (at + 12 > end) break;
    if (view.getUint16(at, le) === 0x112 &&
      view.getUint16(at + 2, le) === 3 && view.getUint32(at + 4, le) === 1) {
      const value = view.getUint16(at + 8, le);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

// Read metadata needed for upload limits and browser processing. Skip encoded
// pixels; do not verify CRCs, scan compressed data, or reject trailing bytes.
// Encoded candidates may exceed the upload bound before choosing the smaller file.
export function inspectImage(buffer: ArrayBuffer, maxBytes = MAX_IMAGE_BYTES) {
  const b = new Uint8Array(buffer), v = new DataView(buffer);
  if (!b.length || b.length > maxBytes) {
    throw new ImageValidationError(413, `每张图片必须非空且不能超过 ${maxBytes / 1024 / 1024} MiB。`);
  }
  const info = identifyImage(b);
  const need = (p: number, n: number) => {
    if (p < 0 || n < 0 || p + n > b.length) unsupportedImage();
  };
  const u24 = (p: number) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
  let width = 0, height = 0, animated = false, orientation = 1;

  if (info.format === "png") {
    width = v.getUint32(16);
    height = v.getUint32(20);
    // APNG declares animation before IDAT. Only visit chunk headers, never data.
    let p = 33;
    while (p + 8 <= b.length) {
      if (matches(b, p + 4, "IDAT") || matches(b, p + 4, "IEND")) break;
      const n = v.getUint32(p);
      need(p, n + 12);
      if (matches(b, p + 4, "acTL")) {
        animated = true;
        break;
      }
      p += n + 12;
    }
  } else if (info.format === "gif") {
    width = v.getUint16(6, true);
    height = v.getUint16(8, true);
    // The client preserves all GIFs without re-encoding, regardless of frames.
  } else if (info.format === "webp") {
    if (matches(b, 12, "VP8X")) {
      width = u24(24) + 1;
      height = u24(27) + 1;
      animated = Boolean(b[20] & 2);
    } else if (matches(b, 12, "VP8 ")) {
      width = v.getUint16(26, true) & 0x3fff;
      height = v.getUint16(28, true) & 0x3fff;
    } else {
      const bits = v.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else if (info.format === "jpeg") {
    let p = 2;
    while (p < b.length) {
      if (b[p++] !== 255) unsupportedImage();
      while (b[p] === 255) p++;
      need(p, 1);
      const marker = b[p++];
      // Everything needed is in the headers before the first scan.
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      need(p, 2);
      const n = v.getUint16(p);
      if (n < 2) unsupportedImage();
      need(p, n);
      if (marker === 0xe1 && n >= 16 && matches(b, p + 2, "Exif\0\0")) {
        orientation = exifOrientation(v, p + 8, p + n);
      }
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (n < 8) unsupportedImage();
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
      }
      p += n;
    }
  } else {
    // Keep the existing uncompressed Windows BMP formats used by the library.
    if (![40, 52, 56, 108, 124].includes(v.getUint32(14, true)) ||
      v.getUint16(26, true) !== 1 ||
      ![1, 4, 8, 16, 24, 32].includes(v.getUint16(28, true)) ||
      v.getUint32(30, true) !== 0) unsupportedImage();
    width = v.getInt32(18, true);
    height = Math.abs(v.getInt32(22, true));
  }

  if (width < 1 || height < 1 || width > 32768 || height > 32768 ||
    width * height > 100_000_000) unsupportedImage();
  if (orientation >= 5) [width, height] = [height, width];
  return { ...info, width, height, size: b.length, animated, orientation };
}
