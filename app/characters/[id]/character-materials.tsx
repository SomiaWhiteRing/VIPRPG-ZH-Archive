import { EmojiDialog } from "@/app/components/emojis/dialog";
import { EmojiLibrary } from "@/app/components/emojis/library";
import { ImageLightbox } from "@/app/components/media/image-lightbox";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import type { CharacterMaterial } from "@/lib/character-materials";
import { CHARACTER_MATERIAL_CATEGORIES } from "@/lib/character-materials";
import { useEffect, useState } from "react";
import Download from "yet-another-react-lightbox/plugins/download";
import { FaceMaterial, FaceQuickCopyControls } from "./face-quick-copy";

const FACE_SCALE_STORAGE_KEY = "viprpg:face-quick-copy:scale";

export function CharacterMaterials({
  materials,
  name,
  characterId,
  canCollect = false,
}: {
  materials: CharacterMaterial[];
  name: string;
  characterId: number;
  canCollect?: boolean;
}) {
  const [collect, setCollect] = useState<CharacterMaterial | null>(null);
  const [active, setActive] = useState(-1);
  const [quickCopy, setQuickCopy] = useState(false);
  const [faceScale, setFaceScale] = useState(2);
  const groups = CHARACTER_MATERIAL_CATEGORIES.map(({ kind, label }) => ({
    kind,
    label,
    items: materials.filter((material) => material.kind === kind),
  })).filter(({ items }) => items.length);
  const ordered = groups.flatMap(({ items }) => items);
  const indices = new Map(
    ordered.map((material, index) => [material.id, index]),
  );

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(FACE_SCALE_STORAGE_KEY));
      if (Number.isInteger(stored) && stored >= 1 && stored <= 4) setFaceScale(stored);
    } catch { /* Storage may be unavailable. */ }
  }, []);

  if (!materials.length)
    return <EmptyState title="暂无公开素材。" variant="plain" />;

  return (
    <>
      <div className="grid gap-6">
        {groups.map(({ kind, label: category, items }) => (
          <section aria-label={category} key={category}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{category}</h2>
              {kind === "faceset" ? (
                <FaceQuickCopyControls
                  enabled={quickCopy}
                  onEnabledChange={setQuickCopy}
                  scale={faceScale}
                  onScaleChange={(scale) => {
                    setFaceScale(scale);
                    try { localStorage.setItem(FACE_SCALE_STORAGE_KEY, String(scale)); }
                    catch { /* Keep using the selected scale for this page. */ }
                  }}
                />
              ) : null}
            </div>
            <ul className={`m-0 list-none items-start gap-2 p-0 ${kind === "faceset" ? "grid grid-cols-2 sm:flex sm:flex-wrap" : "flex flex-wrap"}`}>
              {items.map((material) => {
                const index = indices.get(material.id)!;
                const src = `/api/media/blobs/${material.blobSha256}`;
                const label = `${name} · ${category} ${index + 1}`;
                return (
                  <li className="min-w-0 max-w-full" key={material.id}>
                    {kind === "faceset" ? (
                      <FaceMaterial
                        key={src}
                        sheet={material}
                        label={label}
                        quickCopy={quickCopy}
                        scale={faceScale}
                        onPreview={() => setActive(index)}
                      />
                    ) : (
                      <Button
                        aria-label={`查看${label}`}
                        className="block h-auto min-h-0 max-w-full rounded-none p-0 hover:bg-transparent"
                        onClick={() => setActive(index)}
                        type="button"
                        variant="ghost"
                      >
                        <img
                          alt={label}
                          className="block h-auto max-w-full [image-rendering:pixelated]"
                          height={material.height}
                          src={src}
                          width={material.width}
                          loading="lazy"
                        />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <EmojiDialog
        open={!!collect}
        onOpenChange={(open) => {
          if (!open) setCollect(null);
        }}
        title={`${name} · 收藏为表情`}
      >
        {collect ? (
          <EmojiLibrary
            key={collect.id}
            initialCharacter={{ id: characterId, name, originalName: name }}
            initialSheet={{
              id: Number(collect.id.split(":").at(-1)),
              blobSha256: collect.blobSha256,
              width: collect.width,
              height: collect.height,
            }}
          />
        ) : null}
      </EmojiDialog>
      {active >= 0 ? (
        <ImageLightbox
          open
          close={() => setActive(-1)}
          index={active}
          on={{ view: ({ index }) => setActive(index) }}
          toolbar={{
            buttons: [
              ...(canCollect && ordered[active]?.kind === "faceset"
                ? [
                    <Button
                      variant="ghost"
                      size="sm"
                      key="collect-emoji"
                      type="button"
                      className="yarl__button font-normal"
                      onClick={() => {
                        setCollect(ordered[active]);
                        setActive(-1);
                      }}
                    >
                      收藏为表情
                    </Button>,
                  ]
                : []),
              "close",
            ],
          }}
          slides={ordered.map((material) => ({
            src: `/api/media/blobs/${material.blobSha256}`,
            width: material.width,
            height: material.height,
            alt: name,
          }))}
          plugins={[Download]}
          pixelated
          labels={{ Download: "下载原图" }}
        />
      ) : null}
    </>
  );
}
