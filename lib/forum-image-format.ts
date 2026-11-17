import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locale";
import { FORUM_IMAGE_BYTES } from "@/lib/forum";
import { inspectImage, ImageValidationError } from "@/lib/image-format";
export { ImageValidationError as ForumImageValidationError } from "@/lib/image-format";

export function inspectForumImage(buffer: ArrayBuffer, maxBytes = FORUM_IMAGE_BYTES, locale: UiLocale = DEFAULT_UI_LOCALE) {
  let info: ReturnType<typeof inspectImage>;
  try {
    info = inspectImage(buffer, maxBytes);
  } catch (error) {
    if (!(error instanceof ImageValidationError)) throw error;
    if (error.status === 413 && maxBytes !== FORUM_IMAGE_BYTES) throw error;
    const messageKey = error.status === 413 ? "image.size" : "forum.image.invalidFormat";
    throw new ImageValidationError(error.status, translate(locale, messageKey), messageKey);
  }
  if (info.format === "bmp") throw new ImageValidationError(400, translate(locale, "forum.image.format"), "forum.image.format");
  return info;
}
