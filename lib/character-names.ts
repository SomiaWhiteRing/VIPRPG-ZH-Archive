import { normalizeEntityName } from "@/lib/entity-name";

export type CharacterNameLanguage = "ja" | "zh";

export type CharacterAliasSuggestion = {
  name: string;
  language: CharacterNameLanguage;
};

export type CharacterPortrait = {
  faceSheetId: number;
  blobSha256: string;
  width: number;
  height: number;
  row: number;
  column: number;
};

export type CharacterPortraitChoice = {
  blobSha256: string;
  row: number;
  column: number;
};

export type CharacterFaceSheet = {
  id: number;
  blobSha256: string;
  width: number;
  height: number;
  sourcePageTitle: string | null;
  sourceSectionTitle: string | null;
};

export type CharacterSuggestion = {
  id: number;
  originalName: string;
  primaryName: string;
  defaultPortrait: CharacterPortrait | null;
  faceSheets: CharacterFaceSheet[];
  aliases: CharacterAliasSuggestion[];
  workCount: number;
};

export type CharacterSelection =
  | {
      kind: "existing";
      characterId: number;
      originalName: string;
      displayName: string;
    }
  | {
      kind: "new";
      originalName: string;
      displayName: string;
    };

export type CharacterCreditSelection = {
  selection: CharacterSelection;
  portrait: CharacterPortraitChoice | null;
  faceSheetBlobSha256s: string[];
};

export function characterNameKey(value: string): string {
  return normalizeEntityName(value).toLowerCase();
}

export function characterSelectionKey(value: CharacterSelection): string {
  return value.kind === "existing"
    ? `existing:${value.characterId}`
    : `new:${characterNameKey(value.originalName)}`;
}

export function characterSelectionLabel(value: CharacterSelection): string {
  return `${value.originalName} · ${value.displayName}`;
}
