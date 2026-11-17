import { useEffect, useRef, useState } from "react";
import { useMessages } from "@/lib/i18n/react";
import { Settings } from "lucide-react";
import { drawSeaDialogue, SEA_ASSETS, SEA_WINDOW_HEIGHT, SEA_WINDOW_WIDTH, seaBitmap, type SeaDialogueSide } from "@/lib/ui/eternal-sea";
import type { SeaFont, SeaMessage } from "@/lib/dto/sea";
import { loadSeaFont, seaFontFamily } from "@/app/components/sea/font";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";

export function RpgDialogue({ glyphs, font, faceIndex = 0, avatarUrl, side = "left", anonymous, portrait }: Pick<SeaMessage, "glyphs" | "avatarUrl" | "anonymous" | "portrait"> & {
  font: SeaFont;
  faceIndex?: number;
  side?: SeaDialogueSide;
}) {
  const t = useMessages();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string>();
  const imageUrl = portrait ? `/api/media/blobs/${portrait.blobSha256}` : avatarUrl;
  const showAvatar = Boolean(imageUrl && failedAvatarUrl !== imageUrl);
  const family = seaFontFamily(font);

  useEffect(() => {
    let active = true;
    void Promise.all([
      seaBitmap(`${SEA_ASSETS}/window.png`),
      seaBitmap(`${SEA_ASSETS}/faces.png`),
      loadSeaFont(font),
    ]).then(([window, faces]) => {
      if (active && canvasRef.current) {
        drawSeaDialogue(canvasRef.current, { window, faces: showAvatar ? undefined : faces }, glyphs, family, faceIndex, side);
        setFailed(false);
      }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [glyphs, font, family, faceIndex, showAvatar, side]);
  return (
    <article className="sea-dialogue" data-side={side} translate="no" style={{ fontFamily: `"${family}"` }}>
      <canvas aria-hidden="true" width={SEA_WINDOW_WIDTH} height={SEA_WINDOW_HEIGHT} ref={canvasRef} />
      {showAvatar && (portrait
        ? <span className="sea-dialogue-avatar" onErrorCapture={() => setFailedAvatarUrl(imageUrl)}>
            <CharacterPortrait displayName="" portrait={portrait} fillHeight className="sea-character-face" />
          </span>
        : <img src={avatarUrl} width={48} height={48} alt="" className="sea-dialogue-avatar" onError={() => setFailedAvatarUrl(imageUrl)} />)}
      {failed && <p className="sea-dialogue-fallback">{glyphs.map(glyph => glyph.character).join("")}</p>}
      {anonymous && !failed && <span className="sea-dialogue-mark" role="img" aria-label={t("sea.anonymousMarker")}>
        <Settings aria-hidden="true" />
      </span>}
    </article>
  );
}

export function RpgFace({ index, avatarUrl, portrait }: Pick<SeaMessage, "avatarUrl" | "portrait"> & { index: number }) {
  if (portrait) return <CharacterPortrait displayName="" portrait={portrait} fillHeight className="sea-character-face" />;
  return avatarUrl ? <img src={avatarUrl} width={48} height={48} alt="" className="sea-avatar" /> : (
    <span className="sea-face" aria-hidden="true" style={{ backgroundPosition: `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 100 / 3}%` }} />
  );
}
