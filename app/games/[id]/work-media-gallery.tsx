import { ImageLightbox } from "@/app/components/media/image-lightbox";
import { Button } from "@/app/components/ui/button";
import type { GameMediaAsset } from "@/lib/dto/db/game-library";
import { Maximize2 } from "lucide-react";
import { useState } from "react";

const MEDIA_LABELS = { cover: "封面", preview: "预览图" };

export function WorkMediaGallery({
  items,
  title,
}: {
  items: GameMediaAsset[];
  title: string;
}) {
  const [active, setActive] = useState(-1);

  return (
    <>
      <div
        aria-label="预览图列表"
        className="flex snap-x snap-proximity gap-2.5 overflow-x-auto pb-1.5 scrollbar-thin"
      >
        {items.map((item, index) => {
          const label = MEDIA_LABELS[item.role];
          return (
            <Button
              aria-label={`${label}，点击放大`}
              className="block basis-75 shrink-0 snap-start overflow-hidden rounded-lg border-2 border-border bg-card p-0 text-left hover:border-primary focus-visible:border-primary max-[560px]:basis-[min(300px,78vw)]"
              key={`${item.blobSha256}-${item.sortOrder ?? index}`}
              onClick={() => setActive(index)}
              type="button"
              variant="ghost"
            >
              <span className="relative block aspect-4/3 overflow-hidden bg-[#e7ebe6]">
                <img
                  alt={item.altText ?? `${title} ${label}`}
                  className={"absolute inset-0 h-full w-full " + "object-cover"}
                  sizes="(max-width: 560px) 78vw, 300px"
                  src={`/api/media/blobs/${item.blobSha256}`}
                  loading="lazy"
                />
              </span>
              <span className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted">
                <span>{label}</span>
                <Maximize2 aria-hidden size={14} />
              </span>
            </Button>
          );
        })}
      </div>

      {active >= 0 ? (
        <ImageLightbox open close={() => setActive(-1)} index={active}
          slides={items.map((item) => ({
            src: `/api/media/blobs/${item.blobSha256}`,
            alt: item.altText ?? `${title} ${MEDIA_LABELS[item.role]}`,
          }))}
        />
      ) : null}
    </>
  );
}
