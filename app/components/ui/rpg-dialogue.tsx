import { useEffect, useRef, useState } from "react";
import { drawSeaDialogue, SEA_ASSETS, SEA_WINDOW_HEIGHT, SEA_WINDOW_WIDTH, seaBitmap, type SeaDialogueSide } from "@/lib/ui/eternal-sea";
import type { SeaFont, SeaGlyph } from "@/lib/dto/sea";
import { loadSeaFont, seaFontFamily } from "@/app/components/sea/font";

export function RpgDialogue({ glyphs, font, faceIndex = 0, avatarUrl, side = "left" }: {
  glyphs: SeaGlyph[];
  font: SeaFont;
  faceIndex?: number;
  avatarUrl?: string;
  side?: SeaDialogueSide;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string>();
  const showAvatar = Boolean(avatarUrl && failedAvatarUrl !== avatarUrl);
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
      {showAvatar && <img src={avatarUrl} width={48} height={48} alt="" className="sea-dialogue-avatar" onError={() => setFailedAvatarUrl(avatarUrl)} />}
      {failed && <p className="sea-dialogue-fallback">{glyphs.map(glyph => glyph.character).join("")}</p>}
    </article>
  );
}

export function RpgFace({ index, avatarUrl }: { index: number; avatarUrl?: string }) {
  return avatarUrl ? <img src={avatarUrl} width={48} height={48} alt="" className="sea-avatar" /> : (
    <span className="sea-face" aria-hidden="true" style={{ backgroundPosition: `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 100 / 3}%` }} />
  );
}
