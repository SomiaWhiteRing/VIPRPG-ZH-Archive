import { Button } from "@/app/components/ui/button";
import { ClientOnly } from "@/app/components/ui/client-only";
import type { CustomEmojiDto } from "@/lib/dto/db/work-community";
import type { ForumImage } from "@/lib/forum";
import { FORUM_IMAGE_BYTES } from "@/lib/forum";
import { inspectForumImage } from "@/lib/forum-image-format";
import { lazy, useState } from "react";
import { ForumBody, ForumRequestError } from "./shared";
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
export async function cloneDraftImage(file: File) {
  inspectForumImage(await file.arrayBuffer());
  return draftImageFromFile(file);
}
export async function selectDraftImages(
  files: File[],
  process: (file: File) => Promise<File>,
) {
  if (files.some((file) => !file.size || file.size > FORUM_IMAGE_BYTES))
    throw new Error("每张图片必须非空且不能超过 2 MiB。");
  const processed: File[] = [];
  for (const file of files) processed.push(await process(file));
  return processed.map(draftImageFromFile);
}
export async function uploadDraftImages(
  images: DraftImage[],
  context: { mode: string; topicId?: number; targetId?: number },
  update: (images: DraftImage[], progress: string) => void,
) {
  const next = images.map((image) => ({ ...image }));
  for (let i = 0; i < next.length; i++) {
    const image = next[i];
    if (image.uploaded) continue;
    image.error = undefined;
    update([...next], `上传图片 ${i + 1}/${next.length}`);
    try {
      if (!image.file) throw new Error("本地图片不可用，请重新选择。");
      const form = new FormData();
      form.set("image", image.file);
      form.set("clientId", image.key);
      form.set("mode", context.mode);
      if (context.topicId) form.set("topicId", String(context.topicId));
      if (context.targetId) form.set("targetId", String(context.targetId));
      const response = await fetch("/api/discussions/images", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as {
        ok?: boolean;
        image: ForumImage;
        detail?: string;
        error?: string;
        code?: string;
      };
      if (!response.ok || !result.ok)
        throw new ForumRequestError(
          result.detail ?? result.error ?? "图片上传失败。",
          response.status,
          result.code,
        );
      image.uploaded = result.image;
      update([...next], `上传图片 ${i + 1}/${next.length}`);
    } catch (error) {
      image.error =
        error instanceof Error
          ? error.message
          : "上传未完成，重试将查询同一上传标识。";
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
}: {
  images: ForumImage[];
  body?: string;
  emojis?: CustomEmojiDto[];
}) {
  const [active, setActive] = useState(-1);
  const lastOffset = images.at(-1)?.offset ?? 0;
  return (
    <>
      <div className="grid min-w-0 gap-3">
        {images.map((image, index) => {
          const text = body.slice(
            index ? images[index - 1].offset : 0,
            image.offset,
          );
          return (
            <div
              key={image.id}
              className="grid min-w-0 justify-items-start gap-3"
            >
              {text ? <ForumBody body={text} emojis={emojis} /> : null}
              <Button
                type="button"
                variant="ghost"
                className="h-auto max-w-full rounded-sm p-0"
                aria-label={`查看图片 ${index + 1}`}
                onClick={() => setActive(index)}
              >
                <img
                  src={image.url}
                  alt={`图片 ${index + 1}`}
                  width={image.width}
                  height={image.height}
                  loading="lazy"
                  className="h-auto max-h-[560px] w-auto max-w-full object-contain"
                />
              </Button>
            </div>
          );
        })}
        {body.slice(lastOffset) ? (
          <ForumBody body={body.slice(lastOffset)} emojis={emojis} />
        ) : null}
      </div>
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
