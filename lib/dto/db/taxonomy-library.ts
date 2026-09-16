import type {
  CharacterAliasSuggestion,
  CharacterPortrait,
} from "@/lib/character-names";

export type PublicCharacterSummary = {
  id: number;
  primaryName: string;
  originalName: string;
  defaultPortrait: CharacterPortrait | null;
  description: string | null;
  workCount: number;
  updatedAt: string;
};

export type AdminCharacterEdit = PublicCharacterSummary & {
  aliases: CharacterAliasSuggestion[];
  extra: Record<string, unknown>;
};

export type PublicCharacterIndexEntry = PublicCharacterSummary & {
  aliases: CharacterAliasSuggestion[];
};

export type CharacterAliasMergeCandidate = {
  id: number;
  primaryName: string;
  originalName: string;
};

export type PublicTagSummary = {
  id: number;
  name: string;
  namespace: string;
  description: string | null;
  workCount: number;
  updatedAt: string;
};

export type AdminTagEdit = PublicTagSummary;
