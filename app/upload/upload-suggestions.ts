import "server-only";

import type { CharacterSuggestion } from "@/lib/character-names";
import type { CreatorSuggestion } from "@/lib/creator-names";
import type { UploadTaxonomySuggestion } from "@/app/upload/upload-types";
import {
  listCharacterSuggestions,
  listPublicTags,
} from "@/lib/server/db/taxonomy-library";
import { listCreatorSuggestions } from "@/lib/server/db/creator-library";

export async function loadUploadSuggestions(): Promise<{
  tags: UploadTaxonomySuggestion[];
  characters: CharacterSuggestion[];
  creators: CreatorSuggestion[];
}> {
  const [tags, characters, creators] = await Promise.all([
    listPublicTags({ limit: 120 }),
    listCharacterSuggestions(),
    listCreatorSuggestions(),
  ]);
  return {
    tags: tags.map((tag) => ({ value: tag.name, meta: `${tag.workCount} 部作品` })),
    characters,
    creators,
  };
}
