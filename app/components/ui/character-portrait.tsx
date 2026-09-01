import Image from "next/image";
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
  portraitBlobSha256,
  previewSrc,
  size = 48,
  toneKey = displayName,
}: {
  className?: string;
  displayName: string;
  portraitBlobSha256?: string | null;
  previewSrc?: string | null;
  size?: number;
  toneKey?: number | string;
}) {
  const imageSrc = previewSrc ??
    (portraitBlobSha256 ? `/api/media/blobs/${portraitBlobSha256}` : null);
  if (imageSrc) {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className={cn(
          "aspect-square shrink-0 rounded-lg border border-foreground/15 object-cover [image-rendering:pixelated]",
          className,
        )}
        height={size}
        src={imageSrc}
        unoptimized
        width={size}
      />
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
