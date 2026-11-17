import { translate } from "@/lib/i18n/core";
import type { UiLocale } from "@/lib/i18n/locale";
import { FORUM_IMAGE_BYTES } from "@/lib/forum";
import { inspectForumImage } from "@/lib/forum-image-format";

async function processImage(file: File, locale: UiLocale): Promise<File> {
  const original = await file.arrayBuffer();
  const meta = inspectForumImage(original, FORUM_IMAGE_BYTES, locale);
  if (file.type && file.type !== `image/${meta.format}`)
    throw new Error(translate(locale, "forum.image.typeMismatch"));
  if (meta.format === "gif" || meta.animated)
    return new File([original], file.name, { type: `image/${meta.format}` });

  // Default decoding also applies EXIF orientation in WebView 110, which does
  // not support the explicit "from-image" option. Re-encoding drops EXIF tags.
  const bitmap = await createImageBitmap(file);
  let pixels: ImageData;
  try {
    if (bitmap.width !== meta.width || bitmap.height !== meta.height)
      throw new Error(translate(locale, "image.process.orientation"));
    // UPNG 2.1.0 allocates RGBA bytes + 100 for output; tiny palette PNGs
    // can exceed that buffer. Keep the decoded original before encoding.
    if (meta.format === "png" && meta.width * meta.height <= 1024)
      return new File([original], file.name, { type: "image/png" });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error(translate(locale, "image.process.canvas"));
    context.drawImage(bitmap, 0, 0);
    pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    canvas.width = canvas.height = 0;
  } finally {
    bitmap.close();
  }

  let encoded: ArrayBuffer;
  if (meta.format === "png") {
    const { default: upng } = await import("upng-js");
    encoded = upng.encode([pixels.data.slice().buffer], meta.width, meta.height, 256);
  } else if (meta.format === "jpeg") {
    const { default: encode } = await import("@jsquash/jpeg/encode");
    encoded = await encode(pixels, { quality: 85 });
  } else {
    const { default: encode } = await import("@jsquash/webp/encode");
    encoded = await encode(pixels, { quality: 85, method: 4, lossless: 0, alpha_quality: 100 });
  }
  const output = inspectForumImage(encoded, Infinity, locale);
  if (output.format !== meta.format || output.animated || output.width !== meta.width || output.height !== meta.height || output.orientation !== 1)
    throw new Error(translate(locale, "image.process.encodeFormat"));
  const candidate = new File([encoded], file.name, { type: `image/${meta.format}` });
  const check = await createImageBitmap(candidate);
  try {
    if (check.width !== meta.width || check.height !== meta.height)
      throw new Error(translate(locale, "image.process.encodeDisplay"));
  } finally {
    check.close();
  }
  return encoded.byteLength < original.byteLength
    ? candidate
    : new File([original], file.name, { type: `image/${meta.format}` });
}

const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ file: File; locale: UiLocale }>) => void;
  postMessage: (message: { file: File } | { error: string }) => void;
};
scope.onmessage = async ({ data: { file, locale } }) => {
  try {
    scope.postMessage({ file: await processImage(file, locale) });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : translate(locale, "image.processFailed") });
  }
};
