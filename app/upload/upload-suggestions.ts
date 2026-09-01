import "server-only";

import type { CharacterSuggestion } from "@/lib/character-names";
import type { UploadTaxonomySuggestion } from "@/app/upload/upload-types";
import {
  listCharacterSuggestions,
  listPublicTags,
} from "@/lib/server/db/taxonomy-library";

export async function loadUploadSuggestions(): Promise<{
  tags: UploadTaxonomySuggestion[];
  characters: CharacterSuggestion[];
}> {
  const [tags, characters] = await Promise.all([
    listPublicTags({ limit: 120 }),
    listCharacterSuggestions(),
  ]);
  return {
    tags: tags.map((tag) => ({ value: tag.name, meta: `${tag.workCount} 部作品` })),
    characters,
  };
}
