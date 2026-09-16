import type { CharacterMaterialKind } from "@/lib/character-materials";
import type {
  CharacterFaceSheet,
  CharacterPortrait,
} from "@/lib/character-names";

export type AdminFaceSheet = CharacterFaceSheet & {
  sourcePageUrl: string | null;
  sourceImageUrl: string | null;
  libraryStatus: "pending" | "approved" | "rejected";
};

export type AdminCharacterMaterial = {
  id: number;
  kind: CharacterMaterialKind;
  blobSha256: string;
  width: number;
  height: number;
  relatedNames: string;
  isPublic: number;
};

export type AdminCharacterMaterialPage = {
  sheets: AdminFaceSheet[];
  materials: AdminCharacterMaterial[];
  nextOffset: number | null;
};

export type AdminCharacterPortraitLibrary = {
  sheets: AdminFaceSheet[];
  boundSheetIds: number[];
  defaultPortrait: CharacterPortrait | null;
  materials: AdminCharacterMaterial[];
  boundMaterialIds: number[];
};

export type CharacterPortraitConfiguration = Pick<
  AdminCharacterPortraitLibrary,
  "boundSheetIds" | "defaultPortrait"
>;
