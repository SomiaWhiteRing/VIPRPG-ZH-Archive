import type { CharacterRoleKey } from "@/lib/character-names";

export type CharacterWorkCredit = {
  creditId: number;
  id: number;
  title: string;
  originalTitle: string;
  displayName: string;
  roleKey: CharacterRoleKey;
  spoilerLevel: number;
  notes: string | null;
  authorName: string;
  releaseDate: string | null;
  engineFamily: string;
  language: string;
  coverBlobSha256: string | null;
};

export type CharacterWork = CharacterWorkCredit & {
  credits: CharacterWorkCredit[];
};
