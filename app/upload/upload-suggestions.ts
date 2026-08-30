import "server-only";

import type { UploadTaxonomySuggestion } from "@/app/upload/upload-types";
import {
  listPublicCharacters,
  listPublicTags,
} from "@/lib/server/db/taxonomy-library";

export async function loadUploadSuggestions(): Promise<{
  tags: UploadTaxonomySuggestion[];
  characters: UploadTaxonomySuggestion[];
}> {
  const [tags, characters] = await Promise.all([
    listPublicTags({ limit: 120 }),
    listPublicCharacters({ limit: 120 }),
  ]);
  return {
    tags: tags.map((tag) => ({ value: tag.name, meta: `${tag.workCount} 部作品` })),
    characters: characters.map((character) => ({
      value: character.primaryName,
      meta: `${character.workCount} 部作品`,
    })),
  };
}
