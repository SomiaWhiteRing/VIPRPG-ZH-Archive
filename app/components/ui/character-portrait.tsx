import type { CharacterPortrait as CharacterPortraitValue } from "@/lib/character-names";
import { cn } from "@/lib/ui/cn";
import type { CSSProperties } from "react";

const CHARACTER_TONES = [
  "bg-[#7d5ba6]",
  "bg-[#3d6fb4]",
  "bg-[#3f8f6a]",
  "bg-[#c0584f]",
];

export function CharacterPortrait({
  className,
  displayName,
  portrait,
  previewSrc,
  size = 48,
  fillHeight = false,
  toneKey = displayName,
}: {
  className?: string;
  displayName: string;
  portrait?: CharacterPortraitValue | null;
  previewSrc?: string | null;
  size?: number;
  fillHeight?: boolean;
  toneKey?: number | string;
}) {
  if (portrait) {
    const scale = size / 48;
    const imageStyle: CSSProperties = {
      height: fillHeight
        ? `${(portrait.height / 48) * 100}%`
        : portrait.height * scale,
      left: fillHeight ? `${-portrait.column * 100}%` : -portrait.column * size,
      top: fillHeight ? `${-portrait.row * 100}%` : -portrait.row * size,
      width: fillHeight
        ? `${(portrait.width / 48) * 100}%`
        : portrait.width * scale,
    };
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative block aspect-square shrink-0 overflow-hidden rounded-lg border border-foreground/15 [image-rendering:pixelated]",
          fillHeight && "inline-block h-full w-auto",
          className,
        )}
        style={fillHeight ? undefined : { height: size, width: size }}
      >
        <img
          alt=""
          className="absolute max-w-none select-none"
          draggable={false}
          height={portrait.height}
          src={previewSrc ?? `/api/media/blobs/${portrait.blobSha256}`}
          style={imageStyle}
          width={portrait.width}
          loading="lazy"
        />
      </span>
    );
  }

  if (previewSrc) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={cn(
          "aspect-square shrink-0 rounded-lg border border-foreground/15 object-cover [image-rendering:pixelated]",
          fillHeight && "h-full w-auto",
          className,
        )}
        height={size}
        src={previewSrc}
        width={size}
        loading="lazy"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid aspect-square shrink-0 place-items-center rounded-lg border border-foreground/15 font-serif font-bold text-white [text-shadow:0_1px_0_rgb(0_0_0/30%)]",
        CHARACTER_TONES[toneIndex(toneKey)],
        fillHeight && "inline-grid h-full w-auto",
        className,
      )}
    >
      {displayName.slice(0, 1)}
    </span>
  );
}

function toneIndex(value: number | string): number {
  if (typeof value === "number")
    return Math.abs(value) % CHARACTER_TONES.length;
  let total = 0;
  for (const character of value) total += character.codePointAt(0) ?? 0;
  return total % CHARACTER_TONES.length;
}
