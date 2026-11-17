import { useMessages } from "@/lib/i18n/react";
import { ImageOff } from "lucide-react";
import type { FaceEmoji } from "@/lib/face-emojis";

export function FaceEmojiImage({
  emoji,
  size = 48,
}: {
  emoji: FaceEmoji | null;
  size?: number;
}) {
  const t = useMessages();
  if (!emoji?.available)
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-clip rounded border border-border bg-muted/10 p-1 align-middle text-xs"
        style={{ width: size, height: size }}
        role="img"
        aria-label={t("emoji.library.unavailable")}
        title={t("emoji.library.unavailable")}
        data-face-emoji={emoji?.id || undefined}
      >
        {size <= 24 ? <ImageOff aria-hidden size={16} /> : t("emoji.library.unavailable")}
      </span>
    );
  return (
    <span
      className="relative inline-block shrink-0 overflow-clip align-middle [image-rendering:pixelated]"
      style={{ width: size, height: size }}
      role="img"
      aria-label={t("core.ui.faceEmoji")}
      data-face-emoji={emoji.id || undefined}
    >
      <img
        alt=""
        draggable={false}
        loading="lazy"
        src={`/api/media/blobs/${emoji.blobSha256}`}
        width={emoji.width}
        height={emoji.height}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          width: (emoji.width * size) / 48,
          height: (emoji.height * size) / 48,
          left: -emoji.column * size,
          top: -emoji.row * size,
        }}
      />
    </span>
  );
}
