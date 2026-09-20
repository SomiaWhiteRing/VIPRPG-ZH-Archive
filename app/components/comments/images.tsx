import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { ImageLightbox } from "@/app/components/media/image-lightbox";
import type { CommentImage } from "@/lib/comment-images";

export function CommentImages({ images }: { images: CommentImage[] }) {
  const [active, setActive] = useState(-1);
  if (!images.length) return null;
  return (
    <div className="mt-2">
      <div className="flex max-w-full flex-wrap items-start gap-2">
        {images.slice(0, 3).map((image, index) => {
          const remaining = index === 2 ? images.length - 3 : 0;
          return (
            <Button
              key={image.id}
              type="button"
              variant="ghost"
              className={images.length === 1
                ? "relative block h-auto min-h-0 max-w-full overflow-hidden rounded-md p-0"
                : "relative block aspect-square h-auto min-h-0 w-[min(28%,120px)] overflow-hidden rounded-md bg-muted/10 p-0"}
              aria-label={`查看图片 ${index + 1}，共 ${images.length} 张${remaining > 0 ? `，另有 ${remaining} 张图片` : ""}`}
              onClick={() => setActive(index)}
            >
              <img src={image.url} alt={`评论图片 ${index + 1}`} width={image.width} height={image.height} loading="lazy"
                className={images.length === 1 ? "h-auto max-h-64 w-auto max-w-full object-contain" : "size-full object-cover"} />
              {remaining > 0 ? <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-semibold text-white">+{remaining}</span> : null}
            </Button>
          );
        })}
      </div>
      {active >= 0 ? <ImageLightbox open close={() => setActive(-1)} index={active}
        slides={images.map((image, index) => ({ src: image.url, width: image.width, height: image.height, alt: `评论图片 ${index + 1}` }))} /> : null}
    </div>
  );
}
