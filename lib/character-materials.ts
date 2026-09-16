export const CHARACTER_MATERIAL_CATEGORIES = [
  { kind: "faceset", label: "脸图" },
  { kind: "charset", label: "行走图" },
  { kind: "monster", label: "怪物／战斗图" },
  { kind: "other", label: "插图及其他" },
] as const;

export type CharacterMaterialKind = (typeof CHARACTER_MATERIAL_CATEGORIES)[number]["kind"];

export type CharacterMaterial = {
  id: string;
  kind: CharacterMaterialKind;
  blobSha256: string;
  width: number;
  height: number;
};
