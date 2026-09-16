// One-time local import. Existing classifications are never overwritten.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getPlatformProxy } from "wrangler";

export async function seedCharacterIndex() {
  const platform = await getPlatformProxy({configPath: resolve("wrangler.jsonc"), persist: {path: resolve(".wrangler/state/v3")}, remoteBindings: false, envFiles: []});
  try {
    const database = platform.env.DB;
    const existing = await database.prepare("SELECT count(*) AS count FROM character_categories").first();
    const seed = JSON.parse(readFileSync(new URL("../data/character-classification-bootstrap.json", import.meta.url), "utf8"));
    const characters = (await database.prepare("SELECT id,original_name FROM characters").all()).results;
    const aliases = (await database.prepare("SELECT character_id,name FROM character_aliases WHERE language='ja'").all()).results;
    const key = (name) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    const resolveId = (name) => {
      const exact = characters.filter((c) => key(c.original_name) === key(name));
      const ids = [...new Set(exact.length ? exact.map((c) => c.id) : aliases.filter((a) => key(a.name) === key(name)).map((a) => a.character_id))];
      if (ids.length > 1) throw new Error(`Ambiguous character: ${name}`);
      return ids[0] ?? null;
    };
    const statements = [];
    const newNames = new Set();
    for (const character of seed.newCharacters) {
      if (resolveId(character.originalName) !== null) continue;
      newNames.add(key(character.originalName));
      statements.push(database.prepare("INSERT INTO characters(primary_name,primary_name_key,original_name,original_name_key) VALUES (?,?,?,?)").bind(character.primaryName,key(character.primaryName),character.originalName,key(character.originalName)));
    }
    const reference = (name) => {
      const id = resolveId(name);
      if (id === null && !newNames.has(key(name))) throw new Error(`Missing character: ${name}. Seed the character dictionary first.`);
      return {id, nameKey:key(name)};
    };
    const inserted = new Set();
    for (const category of seed.categories) {
      if (inserted.has(category.id) || (category.parentId && !inserted.has(category.parentId))) throw new Error(`Invalid category hierarchy: ${category.id}`);
      inserted.add(category.id);
      if (existing.count) continue;
      statements.push(database.prepare("INSERT INTO character_categories(id,parent_id,label,original_name,source_url,sort_order) VALUES (?,?,?,?,?,?)").bind(category.id,category.parentId,category.label,category.originalName,category.sourceUrl,category.sortOrder));
    }
    for (const member of seed.memberships) {
      if (existing.count && !newNames.has(key(member.characterName))) continue;
      const role = reference(member.characterName);
      statements.push(database.prepare("INSERT INTO character_category_memberships(category_id,character_id,sort_order,display_name,original_name) VALUES (?,COALESCE(?,(SELECT id FROM characters WHERE original_name_key=?)),?,?,?)").bind(member.categoryId,role.id,role.nameKey,member.sortOrder,member.displayName,member.originalName));
    }
    for (const source of seed.sources) {
      if (existing.count && !newNames.has(key(source.characterName))) continue;
      const role = reference(source.characterName);
      source.urls.forEach((url, order) => statements.push(database.prepare("INSERT INTO character_sources(character_id,url,sort_order) VALUES (COALESCE(?,(SELECT id FROM characters WHERE original_name_key=?)),?,?)").bind(role.id,role.nameKey,url,order)));
    }
    if (statements.length) await database.batch(statements);
    console.log(existing.count
      ? `Existing classifications preserved; added ${newNames.size} missing characters with their memberships and sources.`
      : `Imported ${seed.categories.length} categories, ${seed.memberships.length} memberships and ${newNames.size} new characters in one transaction.`);
  } finally { await platform.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error("This importer accepts no arguments and writes only to local D1.");
  await seedCharacterIndex();
}
