import { listCreatorSuggestions } from "@/app/.server/db/creator-library";
import { readCharacterIndexStructure } from "@/app/.server/db/character-index";
import {
  listCharacterSuggestions,
  listPublicTags,
} from "@/app/.server/db/taxonomy-library";
import type { AppRuntime } from "@/app/.server/runtime";
import type { UploadSuggestions } from "@/app/upload/upload-types";

export async function loadUploadSuggestions(runtime: AppRuntime): Promise<UploadSuggestions> {
  const [tags, characters, creators, characterIndex] = await Promise.all([
    listPublicTags(runtime, { limit: 120 }),
    listCharacterSuggestions(runtime),
    listCreatorSuggestions(runtime),
    readCharacterIndexStructure(runtime),
  ]);
  return {
    tags: tags.map((tag) => ({
      value: tag.name,
      meta: `${tag.workCount} 部作品`,
    })),
    characters,
    characterIndex,
    creators,
  };
}
