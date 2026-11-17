import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, UI_LOCALE_PARAM, type UiLocale } from "@/lib/i18n/locale";
import { useMessages } from "@/lib/i18n/react";
import { requestJson } from "@/lib/ui/api-response";

import { Button } from "@/app/components/ui/button";
import { ClientOnly } from "@/app/components/ui/client-only";
import type { FaceEmoji } from "@/lib/dto/db/work-community";
import { type ForumImage, FORUM_IMAGE_BYTES } from "@/lib/forum";

import { inspectForumImage } from "@/lib/forum-image-format";
import { lazy, useState } from "react";
import { ForumBody } from "./shared";
const ForumLightbox = lazy(() =>
  import("./lightbox").then((m) => ({ default: m.ForumLightbox })),
);

export type DraftImage = {
  key: string;
  offset: number;
  preview: string;
  size: number;
  file?: File;
  uploaded?: ForumImage;
  error?: string;
};
export const existingDraftImages = (images: ForumImage[]): DraftImage[] =>
  images.map((image) => ({
    key: image.id,
    offset: image.offset,
    preview: image.url,
    size: image.size,
    uploaded: image,
  }));
export function draftImageFromFile(file: File): DraftImage {
  return {
    key: crypto.randomUUID(),
    offset: 0,
    preview: URL.createObjectURL(file),
    file,
    size: file.size,
  };
}
export async function cloneDraftImage(file: File, locale: UiLocale = DEFAULT_UI_LOCALE) {
  inspectForumImage(await file.arrayBuffer(), FORUM_IMAGE_BYTES, locale);
  return draftImageFromFile(file);
}
export async function selectDraftImages(
  files: File[],
  process: (file: File) => Promise<File>,
  locale: UiLocale = DEFAULT_UI_LOCALE,
) {
  if (files.some((file) => !file.size || file.size > FORUM_IMAGE_BYTES))
    throw new Error(translate(locale, "image.size"));
  const processed: File[] = [];
  for (const file of files) processed.push(await process(file));
  return processed.map(draftImageFromFile);
}
export async function uploadDraftImages(
  images: DraftImage[],
  context: { mode: string; topicId?: number; targetId?: number },
  update: (images: DraftImage[], progress: string) => void,
  locale: UiLocale = DEFAULT_UI_LOCALE,
) {
  const next = images.map((image) => ({ ...image }));
  for (let i = 0; i < next.length; i++) {
    const image = next[i];
    if (image.uploaded) continue;
    image.error = undefined;
    const progress = translate(locale, "image.uploadIndex", { index: i + 1, total: next.length });
    update([...next], progress);
    try {
      if (!image.file) throw new Error(translate(locale, "forum.image.localMissing"));
      const form = new FormData();
      form.set("image", image.file);
      form.set("clientId", image.key);
      form.set("mode", context.mode);
      if (context.topicId) form.set("topicId", String(context.topicId));
      if (context.targetId) form.set("targetId", String(context.targetId));

      const result = (await requestJson(`/api/discussions/images?${UI_LOCALE_PARAM}=${locale}`, {
        method: "POST",
        body: form,
      }, translate(locale, "image.uploadFailed"))) as {
        ok?: boolean;
        image: ForumImage;
        detail?: string;
        error?: string;
        code?: string;
      };

      image.uploaded = result.image;
      update([...next], progress);
    } catch (error) {
      image.error =
        error instanceof Error
          ? error.message
          : translate(locale, "forum.image.retryId");
      update([...next], "");
      throw error;
    }
  }
  return next.map((image) => image.uploaded!.id);
}

export function ForumImages({
  images,
  body = "",
  emojis = [],
  interactiveElements = true,
  diceKey,
}: {
  images: ForumImage[];
  body?: string;
  emojis?: FaceEmoji[];
  interactiveElements?: boolean;
  diceKey?: string;
}) {
  const t = useMessages();
  const [active, setActive] = useState(-1);
  return (
    <>
      <ForumBody
        body={body}
        emojis={emojis}
        interactiveElements={interactiveElements}
        diceKey={diceKey}
        images={images.map((image, index) => ({
          offset: image.offset,
          content: (
            <span className="my-3 block min-w-0">
              <Button
                type="button"
                variant="ghost"
                className="h-auto max-w-full rounded-sm p-0"
                aria-label={t("image.view", { index: index + 1, total: images.length, remaining: 0 })}
                onClick={() => setActive(index)}
              >
                <img
                  src={image.url}
                  alt={t("image.bodyIndex", { index: index + 1 })}
                  width={image.width}
                  height={image.height}
                  loading="lazy"
                  className="h-auto max-h-[560px] w-auto max-w-full object-contain"
                />
              </Button>
            </span>
          ),
        }))}
      />
      {active >= 0 ? (
        <ClientOnly>
          <ForumLightbox
            images={images}
            active={active}
            setActive={setActive}
          />
        </ClientOnly>
      ) : null}
    </>
  );
}
