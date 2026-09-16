import { characterNameKey, type CharacterAliasSuggestion, type CharacterNameLanguage, type CharacterPortrait } from "@/lib/character-names";

export type CharacterCategory = {
  id: string; parentId: string | null; label: string; originalName: string | null;
  sourceUrl: string | null; sortOrder: number;
};
export type CharacterMembership = { categoryId: string; characterId: number; sortOrder: number; displayName: string | null; originalName: string | null };
export type CharacterNameSelection = { characterId: number; displayName: string; originalName: string };
export type CharacterIndexEntry = {
  id: number; key: string; primaryName: string; originalName: string; aliases: CharacterAliasSuggestion[];
  portrait: CharacterPortrait | null; workCount: number; commentCount: number; materialCount: number; sourceUrls: string[];
};
export type CharacterIndexData = { categories: CharacterCategory[]; memberships: CharacterMembership[]; characters: CharacterIndexEntry[] };
// These are render rows, derived from categories and actual characters; never stored as another identity.
export type CharacterBrowseNode = {
  id: string; kind: "category"; label: string; sourceUrl: string | null; sortOrder: number; children: CharacterBrowseNode[];
} | {
  id: string; kind: "character"; categoryId: string | null; label: string; originalName: string; sortOrder: number; character: CharacterIndexEntry; children: [];
};

export function characterNameOptions(character: Pick<CharacterIndexEntry, "primaryName" | "originalName" | "aliases">, language: CharacterNameLanguage): string[] {
  return [...new Set([language === "zh" ? character.primaryName : character.originalName, ...character.aliases.filter((alias) => alias.language === language).map((alias) => alias.name)])];
}
export function characterMembershipNames(character: CharacterIndexEntry, membership?: Pick<CharacterMembership, "displayName" | "originalName">): CharacterNameSelection {
  return { characterId: character.id, displayName: membership?.displayName ?? character.primaryName, originalName: membership?.originalName ?? character.originalName };
}
export function sortCharacterNodes<T extends { id: string; sortOrder: number }>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
export function characterNodeDescendants(categories: CharacterCategory[], id: string): Set<string> {
  const result = new Set<string>([id]);
  const pending = [id];
  while (pending.length) {
    const parent = pending.pop();
    for (const category of categories) if (category.parentId === parent && !result.has(category.id)) {
      result.add(category.id); pending.push(category.id);
    }
  }
  return result;
}
export function characterNodePath(categories: CharacterCategory[], id: string): string {
  const map = new Map(categories.map((category) => [category.id, category]));
  const labels: string[] = [];
  const visited = new Set<string>();
  let category = map.get(id);
  while (category && !visited.has(category.id)) {
    visited.add(category.id); labels.unshift(category.label);
    category = category.parentId ? map.get(category.parentId) : undefined;
  }
  return labels.join(" / ");
}
export function characterMembershipKey(categoryId: string, characterId: number) {
  return `character:${categoryId}:${characterId}`;
}
export function buildCharacterBrowseTree(data: CharacterIndexData, query: string) {
  const characters = new Map(data.characters.map((character) => [character.id, character]));
  const terms = characterNameKey(query).split(/\s+/).filter(Boolean);
  const matches = (text: string) => terms.every((term) => characterNameKey(text).includes(term));
  const matched = new Set<number>();
  const collect = (parentId: string | null, context: string, visited: Set<string>): CharacterBrowseNode[] => {
    const result: CharacterBrowseNode[] = [];
    for (const category of data.categories.filter((item) => item.parentId === parentId)) {
      if (visited.has(category.id)) continue;
      const next = `${context} ${category.label} ${category.originalName ?? ""}`;
      const children = collect(category.id, next, new Set([...visited, category.id]));
      if (children.length || matches(next)) result.push({ ...category, kind: "category", children });
    }
    for (const member of data.memberships.filter((item) => item.categoryId === parentId)) {
      const character = characters.get(member.characterId);
      if (!character) continue;
      const names = characterMembershipNames(character, member);
      if (!matches(`${context} ${names.displayName} ${names.originalName} ${character.primaryName} ${character.originalName} ${character.aliases.map((alias) => alias.name).join(" ")}`)) continue;
      matched.add(character.id);
      result.push({ id: characterMembershipKey(member.categoryId, character.id), kind: "character", categoryId: member.categoryId, label: names.displayName, originalName: names.originalName, sortOrder: member.sortOrder, character, children: [] });
    }
    return sortCharacterNodes(result);
  };
  const roots = collect(null, "", new Set());
  return { roots: sortCharacterNodes(roots), matchCount: matched.size };
}
