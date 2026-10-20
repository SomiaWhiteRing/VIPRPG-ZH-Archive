import { useEffect, useRef, useState } from "react";
import { drawSeaDialogue, layoutSeaDialogue, SEA_ASSETS, SEA_LINE_HEIGHT, SEA_MAX_LINES, SEA_TEXT_TOP, SEA_WINDOW_HEIGHT, SEA_WINDOW_WIDTH, seaBitmap, seaTextLeft, type SeaDialogueSide } from "@/lib/ui/eternal-sea";

export function RpgDialogue({ name, body, faceIndex = 0, avatarUrl, side = "left" }: {
  name: string;
  body: string;
  faceIndex?: number;
  avatarUrl?: string;
  side?: SeaDialogueSide;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [translation, setTranslation] = useState<{ sourceName: string; sourceBody: string; name: string; body: string }>();
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string>();
  const showAvatar = Boolean(avatarUrl && failedAvatarUrl !== avatarUrl);
  const text = translation?.sourceName === name && translation.sourceBody === body ? translation : { name, body };
  const { placements, lines } = layoutSeaDialogue(text.name, text.body);
  const height = SEA_WINDOW_HEIGHT + Math.max(0, lines.length - SEA_MAX_LINES) * SEA_LINE_HEIGHT;

  useEffect(() => {
    if (!ready || !sourceRef.current) return;
    // Translators edit these continuous text nodes; the bitmap and selection layer
    // keep using the same layout, including when translation is undone.
    function syncTranslation() {
      const translatedName = nameRef.current?.textContent ?? name;
      const translatedBody = bodyRef.current?.textContent ?? body;
      setTranslation(translatedName === name && translatedBody === body ? undefined
        : { sourceName: name, sourceBody: body, name: translatedName, body: translatedBody });
    }
    const observer = new MutationObserver(syncTranslation);
    observer.observe(sourceRef.current, { subtree: true, childList: true, characterData: true });
    syncTranslation();
    return () => observer.disconnect();
  }, [name, body, ready]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      seaBitmap(`${SEA_ASSETS}/window.png`),
      seaBitmap(`${SEA_ASSETS}/font.png`),
      seaBitmap(`${SEA_ASSETS}/faces.png`),
    ]).then(([window, font, faces]) => {
      if (active && canvasRef.current) {
        drawSeaDialogue(canvasRef.current, { window, font, faces: showAvatar ? undefined : faces }, text.name, text.body, faceIndex, side);
        setReady(true);
      }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [text.name, text.body, faceIndex, showAvatar, side]);
  return (
    <article className="sea-dialogue" data-side={side} style={height === SEA_WINDOW_HEIGHT ? undefined : { aspectRatio: `${SEA_WINDOW_WIDTH} / ${height}` }}>
      {ready && !failed && (
        <div className="sea-dialogue-source" ref={sourceRef} translate="yes">
          <p><span ref={nameRef}>{name}</span>：</p>
          <p>「<span ref={bodyRef}>{body}</span>」</p>
        </div>
      )}
      <canvas aria-hidden="true" width={SEA_WINDOW_WIDTH} height={height} ref={canvasRef} />
      {showAvatar && <img src={avatarUrl} width={48} height={48} alt="" className="sea-dialogue-avatar" onError={() => setFailedAvatarUrl(avatarUrl)} />}
      {failed ? <p className="sea-dialogue-fallback">{placements.map(glyph => glyph.character).join("")}</p> : <p className="sea-dialogue-text" translate="no" aria-hidden="true">
        {placements.map((glyph, index) => (
          <span key={index} className="sea-text-glyph" style={{
            left: `${(seaTextLeft(side) + glyph.x) * 100 / SEA_WINDOW_WIDTH}%`,
            top: `${(SEA_TEXT_TOP + glyph.row * SEA_LINE_HEIGHT) * 100 / height}%`,
            width: `${glyph.width * 100 / SEA_WINDOW_WIDTH}%`,
            height: `${SEA_LINE_HEIGHT * 100 / height}%`,
          }}>{glyph.character}</span>
        ))}
      </p>}
    </article>
  );
}

export function RpgFace({ index, avatarUrl }: { index: number; avatarUrl?: string }) {
  return avatarUrl ? <img src={avatarUrl} width={48} height={48} alt="" className="sea-avatar" /> : (
    <span className="sea-face" aria-hidden="true" style={{ backgroundPosition: `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 100 / 3}%` }} />
  );
}
