import { ImageOff } from "lucide-react";
import type { FaceEmoji } from "@/lib/face-emojis";

export function FaceEmojiImage({
  emoji,
  size = 48,
}: {
  emoji: FaceEmoji | null;
  size?: number;
}) {
  if (!emoji?.available)
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted/10 p-1 align-middle text-xs"
        style={{ width: size, height: size }}
        role="img"
        aria-label="表情不可用"
        title="表情不可用"
        data-face-emoji={emoji?.id || undefined}
      >
        {size <= 24 ? <ImageOff aria-hidden size={16} /> : "表情不可用"}
      </span>
    );
  return (
    <span
      className="relative inline-block shrink-0 overflow-hidden align-middle [image-rendering:pixelated]"
      style={{ width: size, height: size }}
      role="img"
      aria-label="脸图表情"
      data-face-emoji={emoji.id || undefined}
    >
      <img
        alt=""
        draggable={false}
        loading="lazy"
        src={`/api/media/blobs/${emoji.blobSha256}`}
        width={emoji.width}
        height={emoji.height}
        className="absolute select-none"
        style={{
          maxWidth: "none",
          width: (emoji.width * size) / 48,
          height: (emoji.height * size) / 48,
          left: -emoji.column * size,
          top: -emoji.row * size,
        }}
      />
    </span>
  );
}
