import { normalizeEntityName } from "@/lib/entity-name";

export type CharacterNameLanguage = "ja" | "zh";

export type CharacterAliasSuggestion = {
  name: string;
  language: CharacterNameLanguage;
};

export type CharacterSuggestion = {
  id: number;
  originalName: string;
  primaryName: string;
  portraitBlobSha256: string | null;
  aliases: CharacterAliasSuggestion[];
  workCount: number;
};

export type CharacterSelection =
  | {
      kind: "existing";
      characterId: number;
      originalName: string;
      displayName: string;
      portraitBlobSha256?: string | null;
    }
  | {
      kind: "new";
      originalName: string;
      displayName: string;
      portraitBlobSha256?: string | null;
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
