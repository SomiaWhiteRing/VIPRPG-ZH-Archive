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

export type PublicCharacterIndexEntry = Pick<PublicCharacterSummary,
  "id" | "primaryName" | "originalName" | "defaultPortrait" | "workCount"
> & {
  aliases: CharacterAliasSuggestion[];
};

export type CharacterAliasMergeCandidate = {
  id: number;
  primaryName: string;
  originalName: string;
};

export type PublicTagSummary = {
  name: string;
  namespace: string;
  description: string | null;
  workCount: number;
  updatedAt: string;
};

export type AdminTagEdit = PublicTagSummary;
