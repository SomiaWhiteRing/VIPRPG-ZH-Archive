import { FORUM_IMAGE_BYTES } from "@/lib/forum";
import { inspectImage, ImageValidationError } from "@/lib/image-format";
export { ImageValidationError as ForumImageValidationError } from "@/lib/image-format";

export function inspectForumImage(buffer: ArrayBuffer, maxBytes = FORUM_IMAGE_BYTES) {
  const info = inspectImage(buffer, maxBytes);
  if (info.format === "bmp") throw new ImageValidationError(400, "论坛图片仅支持 PNG、JPEG、WebP 或 GIF。");
  return info;
}
