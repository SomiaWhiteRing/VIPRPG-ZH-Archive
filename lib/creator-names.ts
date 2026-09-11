import { normalizeEntityName } from "@/lib/entity-name";

export type CreatorAliasSuggestion = {
  name: string;
};

export type CreatorSuggestion = {
  id: number;
  name: string;
  aliases: CreatorAliasSuggestion[];
  workCount: number;
};

export type CreatorSelection =
  | {
      kind: "existing";
      creatorId: number;
      name: string;
      displayName: string;
    }
  | {
      kind: "new";
      name: string;
      displayName: string;
    };

export function creatorNameKey(value: string): string {
  return normalizeEntityName(value).toLocaleLowerCase();
}

export type ConfirmedCreatorSelection = Extract<CreatorSelection, { kind: "existing" }>;

export function creatorSelectionKey(value: CreatorSelection): string {
  return value.kind === "existing"
    ? `existing:${value.creatorId}`
    : `new:${creatorNameKey(value.name)}`;
}
