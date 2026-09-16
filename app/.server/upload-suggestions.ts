import { listCreatorSuggestions } from "@/app/.server/db/creator-library";
import {
  listCharacterSuggestions,
  listPublicTags,
} from "@/app/.server/db/taxonomy-library";
import type { AppRuntime } from "@/app/.server/runtime";
import type { UploadTaxonomySuggestion } from "@/app/upload/upload-types";
import type { CharacterSuggestion } from "@/lib/character-names";
import type { CreatorSuggestion } from "@/lib/creator-names";

export async function loadUploadSuggestions(runtime: AppRuntime): Promise<{
  tags: UploadTaxonomySuggestion[];
  characters: CharacterSuggestion[];
  creators: CreatorSuggestion[];
}> {
  const [tags, characters, creators] = await Promise.all([
    listPublicTags(runtime, { limit: 120 }),
    listCharacterSuggestions(runtime),
    listCreatorSuggestions(runtime),
  ]);
  return {
    tags: tags.map((tag) => ({
      value: tag.name,
      meta: `${tag.workCount} 部作品`,
    })),
    characters,
    creators,
  };
}
