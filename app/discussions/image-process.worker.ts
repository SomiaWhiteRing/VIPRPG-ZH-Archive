import { inspectForumImage } from "@/lib/forum-image-format";

async function processImage(file: File): Promise<File> {
  const original = await file.arrayBuffer();
  const meta = inspectForumImage(original);
  if (file.type && file.type !== `image/${meta.format}`)
    throw new Error("文件类型与图片内容不一致。");
  if (meta.format === "gif" || meta.animated)
    return new File([original], file.name, { type: `image/${meta.format}` });

  // Browser decode applies EXIF orientation once; encoders receive oriented RGBA
  // and do not copy the source EXIF tag into the new file.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  let pixels: ImageData;
  try {
    if (bitmap.width !== meta.width || bitmap.height !== meta.height)
      throw new Error("浏览器无法保持图片的显示方向及尺寸。");
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理此图片。");
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
  const output = inspectForumImage(encoded, Infinity);
  if (output.format !== meta.format || output.animated || output.width !== meta.width || output.height !== meta.height || output.orientation !== 1)
    throw new Error("编码结果的格式或尺寸不正确。");
  const candidate = new File([encoded], file.name, { type: `image/${meta.format}` });
  const check = await createImageBitmap(candidate);
  try {
    if (check.width !== meta.width || check.height !== meta.height)
      throw new Error("编码结果无法正确显示。");
  } finally {
    check.close();
  }
  return encoded.byteLength < original.byteLength
    ? candidate
    : new File([original], file.name, { type: `image/${meta.format}` });
}

const scope = self as unknown as {
  onmessage: (event: MessageEvent<File>) => void;
  postMessage: (message: { file: File } | { error: string }) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    scope.postMessage({ file: await processImage(data) });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : "图片处理失败，请重试。" });
  }
};
