import Image from "next/image";
import type { CSSProperties } from "react";
import type { CharacterPortrait as CharacterPortraitValue } from "@/lib/character-names";
import { cn } from "@/lib/ui/cn";

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
  toneKey = displayName,
}: {
  className?: string;
  displayName: string;
  portrait?: CharacterPortraitValue | null;
  previewSrc?: string | null;
  size?: number;
  toneKey?: number | string;
}) {
  if (previewSrc) {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className={cn(
          "aspect-square shrink-0 rounded-lg border border-foreground/15 object-cover [image-rendering:pixelated]",
          className,
        )}
        height={size}
        src={previewSrc}
        unoptimized
        width={size}
      />
    );
  }

  if (portrait) {
    const scale = size / 48;
    const imageStyle: CSSProperties = {
      height: portrait.height * scale,
      left: -portrait.column * size,
      maxWidth: "none",
      top: -portrait.row * size,
      width: portrait.width * scale,
    };
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative block aspect-square shrink-0 overflow-hidden rounded-lg border border-foreground/15 [image-rendering:pixelated]",
          className,
        )}
        style={{ height: size, width: size }}
      >
        <Image
          alt=""
          className="absolute select-none"
          draggable={false}
          height={portrait.height}
          src={`/api/media/blobs/${portrait.blobSha256}`}
          style={imageStyle}
          unoptimized
          width={portrait.width}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid aspect-square shrink-0 place-items-center rounded-lg border border-foreground/15 font-serif font-bold text-white [text-shadow:0_1px_0_rgb(0_0_0/30%)]",
        CHARACTER_TONES[toneIndex(toneKey)],
        className,
      )}
    >
      {displayName.slice(0, 1)}
    </span>
  );
}

function toneIndex(value: number | string): number {
  if (typeof value === "number") return Math.abs(value) % CHARACTER_TONES.length;
  let total = 0;
  for (const character of value) total += character.codePointAt(0) ?? 0;
  return total % CHARACTER_TONES.length;
}
