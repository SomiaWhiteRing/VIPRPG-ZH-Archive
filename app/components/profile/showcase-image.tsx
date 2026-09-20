import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import type { ShowcaseTarget } from "@/lib/showcase";

export function ShowcaseImage({ target }: { target: ShowcaseTarget }) {
  if (target.kind === "work") {
    return (
      <WorkThumbnail
        blobSha256={target.imageSha256}
        width={320}
        height={240}
        fallback="暂无封面"
        fallbackClassName="flex h-full items-center text-xs text-muted"
        imageClassName="block h-full w-auto max-w-none object-contain object-left"
      />
    );
  }
  return target.kind === "character" ? (
    <CharacterPortrait
      displayName={target.name}
      portrait={target.portrait}
      toneKey={target.id}
      fillHeight
      className="rounded-none border-0 text-4xl"
    />
  ) : (
    <CreatorPortrait
      avatarBlobSha256={target.imageSha256}
      name={target.name}
      size={48}
      className="inline-grid h-full w-auto max-w-none shrink-0 rounded-none border-0 text-4xl"
    />
  );
}
