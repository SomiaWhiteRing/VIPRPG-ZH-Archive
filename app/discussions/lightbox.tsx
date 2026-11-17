import { useMessages } from "@/lib/i18n/react";
import { ImageLightbox } from "@/app/components/media/image-lightbox";
import type { ForumImage } from "@/lib/forum";
export function ForumLightbox({
  images,
  active,
  setActive,
}: {
  images: ForumImage[];
  active: number;
  setActive: (n: number) => void;
}) {
  const t = useMessages();
  return (
    <ImageLightbox
      open={active >= 0}
      close={() => setActive(-1)}
      index={active}
      slides={images.map((image, index) => ({
        src: image.url,
        width: image.width,
        height: image.height,
        alt: t("image.bodyIndex", { index: index + 1 }),
      }))}
    />
  );
}
