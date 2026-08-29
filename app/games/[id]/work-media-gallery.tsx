"use client";

import { Button } from "@/app/components/ui/button";
import type { GameMediaAsset } from "@/lib/server/db/game-library";
import { Maximize2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const MEDIA_LABELS: Record<string, string> = {
  icon: "图标",
  cover: "封面",
  preview: "预览图",
  screenshot: "截图",
  banner: "横幅",
  other: "媒体",
};

export function WorkMediaGallery({
  items,
  title,
}: {
  items: GameMediaAsset[];
  title: string;
}) {
  const [selected, setSelected] = useState<GameMediaAsset | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) {
      dialog.showModal();
    } else if (!selected && dialog.open) {
      dialog.close();
    }
  }, [selected]);

  return (
    <>
      <div
        aria-label="截图列表"
        className="flex snap-x snap-proximity gap-2.5 overflow-x-auto pb-1.5 scrollbar-thin"
      >
        {items.map((item, index) => {
          const label = item.title?.trim() || MEDIA_LABELS[item.kind] || "媒体";
          return (
            <Button
              aria-label={`${label}，点击放大`}
              className="block basis-75 shrink-0 snap-start overflow-hidden rounded-lg border-2 border-border bg-card p-0 text-left hover:border-primary focus-visible:border-primary max-[560px]:basis-[min(300px,78vw)]"
              key={`${item.blobSha256}-${item.sortOrder ?? index}`}
              onClick={() => setSelected(item)}
              type="button"
              variant="ghost"
            >
              <span className="relative block aspect-4/3 overflow-hidden bg-[#e7ebe6]">
                <Image
                  alt={item.altText ?? `${title} ${label}`}
                  className="object-cover"
                  fill
                  sizes="(max-width: 560px) 78vw, 300px"
                  src={`/api/media/blobs/${item.blobSha256}`}
                  unoptimized
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

      <dialog
        aria-label="截图放大查看"
        className="m-auto w-[min(880px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-lg border border-border bg-card p-0 text-foreground shadow-[0_24px_64px_rgb(23_33_43/28%)] backdrop:bg-[rgb(23_33_43/48%)]"
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
        ref={dialogRef}
      >
        {selected ? (
          <>
            <div className="relative min-h-48 aspect-4/3 bg-[#e7ebe6]">
              <Image
                alt={selected.altText ?? title}
                className="object-contain"
                fill
                sizes="(max-width: 900px) calc(100vw - 2rem), 880px"
                src={`/api/media/blobs/${selected.blobSha256}`}
                unoptimized
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2">
              <strong>{selected.title?.trim() || MEDIA_LABELS[selected.kind] || "媒体"}</strong>
              <Button
                aria-label="关闭截图"
                onClick={() => dialogRef.current?.close()}
                size="sm"
                type="button"
                variant="ghost"
              >
                <X aria-hidden />
                关闭
              </Button>
            </div>
          </>
        ) : null}
      </dialog>
    </>
  );
}
