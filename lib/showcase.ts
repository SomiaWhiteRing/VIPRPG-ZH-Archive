import type {
  CharacterPortrait,
  CharacterPortraitChoice,
  CharacterFaceSheet,
} from "@/lib/character-names";

export const SHOWCASE_KINDS = ["work", "character", "creator"] as const;
export type ShowcaseKind = (typeof SHOWCASE_KINDS)[number];
export const SHOWCASE_LABELS: Record<ShowcaseKind, string> = {
  work: "作品",
  character: "角色",
  creator: "作者",
};
export const SHOWCASE_NOTE_LIMIT = 500;

export type ShowcaseTarget = {
  kind: ShowcaseKind;
  id: number;
  name: string;
  imageSha256: string | null;
  portrait: CharacterPortrait | null;
};

export type ShowcaseEntry = {
  kind: ShowcaseKind;
  targetId: number;
  note: string;
  portrait: CharacterPortraitChoice | null;
  target: ShowcaseTarget | null;
};

export type ShowcasePortraitPage = {
  items: Pick<CharacterFaceSheet, "id" | "blobSha256" | "width" | "height">[];
  more: boolean;
  defaultPortrait: CharacterPortrait | null;
};

export type ShowcaseSnapshot = {
  revision: number;
  entries: ShowcaseEntry[];
};

export function isShowcaseKind(value: unknown): value is ShowcaseKind {
  return SHOWCASE_KINDS.some((kind) => kind === value);
}

export function showcaseHref(target: ShowcaseTarget): string {
  const paths = { work: "games", character: "characters", creator: "creators" };
  return `/${paths[target.kind]}/${target.id}`;
}
