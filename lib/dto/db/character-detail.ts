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
  releaseDate: string | null;
  coverBlobSha256: string | null;
};

export type CharacterWork = CharacterWorkCredit & {
  credits: CharacterWorkCredit[];
};
