import { FORUM_IMAGE_BYTES } from "@/lib/forum";
export class ForumImageValidationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Container validation only: never allocate decoded pixels on the server.
// Encoded candidates may exceed the upload bound before choosing the smaller file.
export function inspectForumImage(buffer: ArrayBuffer, maxBytes = FORUM_IMAGE_BYTES) {
  const b = new Uint8Array(buffer),
    v = new DataView(buffer);
  const bad = () => {
    throw new ForumImageValidationError(
      400,
      "图片损坏或格式不支持，请选择 PNG、JPEG、WebP 或 GIF。",
    );
  };
  if (!b.length || b.length > maxBytes)
    throw new ForumImageValidationError(413, "每张图片必须非空且不能超过 2 MiB。");
  const need = (p: number, n: number) => {
    if (!Number.isSafeInteger(p) || !Number.isSafeInteger(n) || p < 0 || n < 0 || p + n > b.length) bad();
  };
  const text = (p: number, n: number) => {
    need(p, n);
    return String.fromCharCode(...b.subarray(p, p + n));
  };
  const u16 = (p: number) => {
    need(p, 2);
    return v.getUint16(p, true);
  };
  const u32 = (p: number, le = false) => {
    need(p, 4);
    return v.getUint32(p, le);
  };
  const u24 = (p: number) => {
    need(p, 3);
    return b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
  };
  let width = 0,
    height = 0,
    frames = 1,
    format = "",
    animated = false,
    orientation = 1;
  if (b.length >= 33 && text(0, 8) === "\x89PNG\r\n\x1a\n") {
    format = "png";
    if (u32(8) !== 13 || text(12, 4) !== "IHDR") bad();
    width = u32(16);
    height = u32(20);
    const depths: Record<number, number[]> = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
    if (!depths[b[25]]?.includes(b[24]) || b[26] || b[27] || b[28]>1) bad();
    let p = 8,
      ended = false,
      data = false,
      actualFrames = 0,
      sequence = 0;
    while (p < b.length) {
      const n = u32(p),
        kind = text(p + 4, 4);
      need(p, n + 12);
      if (p !== 8 && kind === "IHDR") bad();
      let crc = 0xffffffff;
      for (let i = p + 4; i < p + 8 + n; i++) {
        crc ^= b[i];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== u32(p + 8 + n)) bad();
      if (kind === "acTL") {
        if (n !== 8 || data || animated) bad();
        animated = true;
        frames = u32(p + 8);
        if (!frames) bad();
      }
      if (kind === "fcTL") {
        if (!animated || n !== 26 || u32(p+8) !== sequence++) bad();
        const w = u32(p+12), h = u32(p+16);
        if (!w || !h || u32(p+20)+w>width || u32(p+24)+h>height || b[p+32]>2 || b[p+33]>1) bad();
        actualFrames++;
      }
      if (kind === "fdAT" && (!animated || !actualFrames || n < 5 || u32(p+8) !== sequence++)) bad();
      if (kind === "IDAT") data = true;
      p += n + 12;
      if (kind === "IEND") {
        ended = n === 0 && p === b.length;
        break;
      }
    }
    if (!ended || !data || (animated && actualFrames !== frames)) bad();
  } else if (b.length >= 13 && ["GIF87a", "GIF89a"].includes(text(0, 6))) {
    format = "gif";
    width = u16(6);
    height = u16(8);
    frames = 0;
    let p = 13 + (b[10] & 128 ? 3 * (1 << ((b[10] & 7) + 1)) : 0),
      ended = false;
    const blocks = () => {
      while (true) {
        need(p, 1);
        const n = b[p++];
        if (!n) break;
        need(p, n);
        p += n;
      }
    };
    while (p < b.length) {
      const marker = b[p++];
      if (marker === 0x3b) {
        ended = p === b.length;
        break;
      }
      if (marker === 0x21) {
        need(p, 1);
        p++;
        blocks();
      } else if (marker === 0x2c) {
        need(p, 9);
        const x = u16(p),
          y = u16(p + 2),
          w = u16(p + 4),
          h = u16(p + 6),
          flags = b[p + 8];
        if (!w || !h || x + w > width || y + h > height) bad();
        p += 9;
        if (flags & 128) p += 3 * (1 << ((flags & 7) + 1));
        need(p, 1);
        if (b[p] < 2 || b[p] > 8) bad();
        p++;
        blocks();
        frames++;
      } else bad();
    }
    if (!ended || !frames) bad();
  } else if (b.length >= 16 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    format = "webp";
    if (u32(4, true) + 8 !== b.length) bad();
    let p = 12,
      frameCount = 0,
      animationHeader = false,
      data = false;
    while (p < b.length) {
      const kind = text(p, 4),
        n = u32(p + 4, true),
        d = p + 8;
      need(d, n);
      if (kind === "VP8X") {
        if (n !== 10 || p !== 12) bad();
        animated = Boolean(b[d] & 2);
        width = u24(d + 4) + 1;
        height = u24(d + 7) + 1;
      }
      if (kind === "VP8 ") {
        if (animated || data || n < 10 || text(d + 3, 3) !== "\x9d\x01\x2a") bad();
        if (width && (width !== (u16(d+6)&0x3fff) || height !== (u16(d+8)&0x3fff))) bad();
        if (!width) {
          width = u16(d + 6) & 0x3fff;
          height = u16(d + 8) & 0x3fff;
        }
        data = true;
      }
      if (kind === "VP8L") {
        if (animated || data || n < 5 || b[d] !== 0x2f) bad();
        const bits = u32(d + 1, true);
        if (bits>>>29 || (width && (width !== (bits&0x3fff)+1 || height !== ((bits>>>14)&0x3fff)+1))) bad();
        if (!width) {
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
        }
        data = true;
      }
      if (kind === "ANMF") {
        if (
          !animated || !animationHeader || n < 16 ||
          u24(d) * 2 + u24(d + 6) + 1 > width ||
          u24(d + 3) * 2 + u24(d + 9) + 1 > height
        )
          bad();
        let q = d + 16, payloads = 0;
        while (q < d + n) {
          const inner = text(q,4), size = u32(q+4,true), start = q+8;
          if (start+size+(size%2)>d+n || !["ALPH","VP8 ","VP8L"].includes(inner)) bad();
          need(start,size);
          if (inner === "VP8 " || inner === "VP8L") {
            const w = u24(d+6)+1, h = u24(d+9)+1;
            if (inner === "VP8 ") {
              if (size<10 || text(start+3,3)!=="\x9d\x01\x2a" || (u16(start+6)&0x3fff)!==w || (u16(start+8)&0x3fff)!==h) bad();
            } else {
              if (size<5 || b[start]!==0x2f) bad();
              const bits = u32(start+1,true);
              if ((bits&0x3fff)+1!==w || ((bits>>>14)&0x3fff)+1!==h || bits>>>29) bad();
            }
            payloads++;
          }
          q = start+size+(size%2);
        }
        if (q!==d+n || payloads!==1) bad();
        frameCount++;
        data = true;
      }
      if (kind === "ANIM") {
        if (!animated || animationHeader || n !== 6 || frameCount) bad();
        animationHeader = true;
      }
      p = d + n + (n % 2);
    }
    frames = frameCount || 1;
    if (!data || p !== b.length || (animated && (!animationHeader || !frameCount)) || (!animated && frameCount)) bad();
  } else if (
    b.length >= 4 &&
    b[0] === 255 &&
    b[1] === 216 &&
    b.at(-2) === 255 &&
    b.at(-1) === 217
  ) {
    format = "jpeg";
    let p = 2,
      scan = false;
    while (p < b.length - 2) {
      if (b[p++] !== 255) bad();
      while (b[p] === 255) p++;
      need(p, 1);
      const marker = b[p++];
      if (marker === 0xd9 || marker === 0xd8 || marker === 0 || (marker>=0xd0 && marker<=0xd7)) bad();
      need(p, 2);
      const n = v.getUint16(p);
      if (n < 2) bad();
      need(p, n);
      if (marker === 0xe1 && n >= 16 && text(p+2,6) === "Exif\0\0") {
        const t = p+8, le = text(t,2) === "II";
        if (!le && text(t,2) !== "MM") bad();
        const ex16 = (at: number) => { if(at<t || at+2>p+n) bad(); return v.getUint16(at,le); };
        const ex32 = (at: number) => { if(at<t || at+4>p+n) bad(); return v.getUint32(at,le); };
        if (ex16(t+2)!==42) bad();
        const ifd = t+ex32(t+4), count = ex16(ifd);
        for(let i=0;i<count;i++) {
          const at = ifd+2+12*i;
          if(at+12>p+n) bad();
          if(ex16(at)===0x112) {
            if(ex16(at+2)!==3 || ex32(at+4)!==1) bad();
            orientation = ex16(at+8);
            if(orientation<1 || orientation>8) bad();
          }
        }
      }
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (n < 8) bad();
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
      }
      if (marker === 0xda) {
        scan = true;
        p += n;
        // Traverse scan bytes and restart markers, including progressive scans.
        while (p < b.length - 2) {
          if (b[p] !== 255) { p++; continue; }
          if (b[p+1] === 0 || (b[p+1]>=0xd0 && b[p+1]<=0xd7)) { p+=2; continue; }
          if (b[p+1] === 255) { p++; continue; }
          break;
        }
        continue;
      }
      p += n;
    }
    if (!scan || p !== b.length-2) bad();
  } else bad();
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<1 || height<1 || frames<1) bad();
  if (orientation>=5) [width,height] = [height,width];
  return { width, height, format, size: b.length, animated, orientation };
}
