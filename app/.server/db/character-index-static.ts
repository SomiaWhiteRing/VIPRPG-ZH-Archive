import { getD1 } from "./d1";
import { memoizeRequest, type AppRuntime } from "../runtime";
import type { CharacterCategory, CharacterMembership } from "@/lib/character-index";
import type { CharacterAliasSuggestion } from "@/lib/character-names";

type IndexStatic = {
  categories: CharacterCategory[];
  memberships: CharacterMembership[];
  sources: { characterId: number; url: string }[];
  aliases: (CharacterAliasSuggestion & { character_id: number })[];
};

// Only settled public taxonomy data crosses requests. The revision is read on
// every request; DB triggers invalidate every isolate, including direct edits.
// Portrait visibility, counts and user permissions remain live queries.
const snapshots = new WeakMap<D1Database, { revision: number; value: IndexStatic }>();
const revisionSql = "SELECT revision FROM character_index_revision WHERE id=1";

export function readCharacterIndexStatic(runtime: AppRuntime): Promise<IndexStatic> {
  return memoizeRequest(runtime, "character-index-static", async () => {
    const db = getD1(runtime);
    const revision = await db.prepare(revisionSql).first<{ revision: number }>();
    const cached = snapshots.get(db);
    if (revision && cached?.revision === revision.revision) return cached.value;
    // D1 batch gives the revision and all four tables one consistent snapshot.
    const [version, categories, memberships, sources, aliases] = await db.batch([
      db.prepare(revisionSql),
      db.prepare("SELECT id,parent_id AS parentId,label,original_name AS originalName,source_url AS sourceUrl,sort_order AS sortOrder FROM character_categories ORDER BY sort_order,id"),
      db.prepare("SELECT category_id AS categoryId,character_id AS characterId,sort_order AS sortOrder,display_name AS displayName,original_name AS originalName FROM character_category_memberships ORDER BY sort_order,character_id"),
      db.prepare("SELECT character_id AS characterId,url FROM character_sources ORDER BY sort_order,url"),
      db.prepare("SELECT character_id,name,language FROM character_aliases ORDER BY character_id,language,name"),
    ]);
    const value: IndexStatic = {
      categories: categories.results as CharacterCategory[],
      memberships: memberships.results as CharacterMembership[],
      sources: sources.results as IndexStatic["sources"],
      aliases: aliases.results as IndexStatic["aliases"],
    };
    const at = (version.results[0] as { revision: number }).revision;
    // A slower older request must not replace a newer settled snapshot.
    if ((snapshots.get(db)?.revision ?? -1) <= at) snapshots.set(db, { revision: at, value });
    return value;
  });
}
