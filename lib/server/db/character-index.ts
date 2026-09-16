import { characterMembershipKey, characterNameOptions, characterNodeDescendants, sortCharacterNodes, type CharacterCategory, type CharacterIndexData, type CharacterMembership } from "@/lib/character-index";
import { getD1 } from "@/lib/server/db/d1";
import { listPublicCharacterIndex } from "@/lib/server/db/taxonomy-library";
import { HttpError } from "@/lib/server/http/json";
import { normalizeHttpUrl } from "@/lib/server/http/safe-url";
import type { CharacterAliasSuggestion } from "@/lib/character-names";

function structureStatements(database: D1Database) {
  return [
    database.prepare("SELECT id,parent_id AS parentId,label,original_name AS originalName,source_url AS sourceUrl,sort_order AS sortOrder FROM character_categories ORDER BY sort_order,id"),
    database.prepare("SELECT category_id AS categoryId,character_id AS characterId,sort_order AS sortOrder,display_name AS displayName,original_name AS originalName FROM character_category_memberships ORDER BY sort_order,character_id"),
  ];
}

export async function readCharacterIndex(): Promise<CharacterIndexData> {
  const database = getD1();
  const [categories, memberships, sources] = await database.batch([
    ...structureStatements(database),
    database.prepare("SELECT character_id AS characterId,url FROM character_sources ORDER BY sort_order,url"),
  ]);
  const urlsByCharacter = new Map<number, string[]>();
  for (const row of sources.results as { characterId: number; url: string }[]) {
    const urls = urlsByCharacter.get(row.characterId) ?? [];
    urls.push(row.url);
    urlsByCharacter.set(row.characterId, urls);
  }
  const { commentCounts, materialCounts } = await readCharacterCounts();
  return {
    categories: categories.results as CharacterCategory[], memberships: memberships.results as CharacterMembership[],
    characters: (await listPublicCharacterIndex()).map((character) => ({
      id: character.id, key: `character-${character.id}`, primaryName: character.primaryName, originalName: character.originalName,
      aliases: character.aliases, portrait: character.defaultPortrait,
      workCount: character.workCount, sourceUrls: urlsByCharacter.get(character.id) ?? [],
      commentCount: commentCounts.get(character.id) ?? 0, materialCount: materialCounts.get(character.id) ?? 0,
    })),
  };
}
export async function readCharacterCounts(characterIds?: readonly number[]) {
  if (characterIds?.length === 0) return { commentCounts: new Map<number, number>(), materialCounts: new Map<number, number>() };
  const database = getD1();
  const selected = characterIds === undefined ? null : JSON.stringify([...new Set(characterIds)]);
  const commentFilter = selected === null ? "" : " AND c.character_id IN (SELECT value FROM json_each(?))";
  const materialFilter = selected === null ? "" : " AND binding.character_id IN (SELECT value FROM json_each(?))";
  const [comments, materials] = await database.batch([
    database.prepare(`SELECT c.character_id AS characterId,COUNT(*) AS count FROM comments c
      JOIN users u ON u.id=c.user_id JOIN comments root ON root.id=COALESCE(c.root_comment_id,c.id)
      JOIN users root_user ON root_user.id=root.user_id
      WHERE c.character_id IS NOT NULL AND c.status='published' AND root.status='published'
        AND u.status IN ('active','deleted') AND root_user.status IN ('active','deleted')${commentFilter} GROUP BY c.character_id`).bind(...(selected === null ? [] : [selected])),
    database.prepare(`SELECT characterId,COUNT(*) AS count FROM (
      SELECT binding.character_id AS characterId FROM character_face_sheet_bindings binding
      JOIN face_sheets fs ON fs.id=binding.face_sheet_id JOIN blobs b ON b.sha256=fs.blob_sha256
      WHERE fs.library_status='approved' AND b.status='active' AND b.content_type_hint LIKE 'image/%'${materialFilter}
      UNION ALL
      SELECT binding.character_id AS characterId FROM character_material_bindings binding
      JOIN character_materials m ON m.id=binding.material_id JOIN blobs b ON b.sha256=m.blob_sha256
      WHERE b.status='active' AND b.content_type_hint LIKE 'image/%'${materialFilter}
    ) GROUP BY characterId`).bind(...(selected === null ? [] : [selected, selected])),
  ]);
  const commentCounts = new Map((comments.results as { characterId: number; count: number }[]).map((row) => [row.characterId,row.count]));
  const materialCounts = new Map((materials.results as { characterId: number; count: number }[]).map((row) => [row.characterId,row.count]));
  return { commentCounts, materialCounts };
}
function text(value: unknown, field: string, required = false, max = 160): string | null {
  if (value !== null && value !== undefined && typeof value !== "string") throw new HttpError(400, `${field}格式不正确`);
  const result = String(value ?? "").trim();
  if ((required && !result) || result.length > max) throw new HttpError(400, `${field}${required ? "不能为空，且" : ""}不能超过 ${max} 个字符`);
  return result || null;
}
export async function updateCharacterIndex(body: Record<string, unknown>): Promise<{ categoryId: string | null; characterId: number | null }> {
  const database = getD1();
  const [categories, memberships, characters, aliases] = await database.batch([
    ...structureStatements(database),
    database.prepare("SELECT id,primary_name AS primaryName,original_name AS originalName FROM characters"),
    database.prepare("SELECT character_id AS characterId,name,language FROM character_aliases"),
  ]);
  const names = new Map<number, CharacterAliasSuggestion[]>();
  for (const row of aliases.results as (CharacterAliasSuggestion & { characterId: number })[]) {
    const list = names.get(row.characterId) ?? [];
    list.push({ name: row.name, language: row.language });
    names.set(row.characterId, list);
  }
  const data = {
    categories: categories.results as CharacterCategory[],
    memberships: memberships.results as CharacterMembership[],
    characters: (characters.results as { id: number; primaryName: string; originalName: string }[])
      .map((character) => ({ ...character, aliases: names.get(character.id) ?? [] })),
  };
  const categoryId = text(body.categoryId, "分类", false, 240);
  const category = data.categories.find((item) => item.id === categoryId);
  const requireCategory = (id: string | null) => {
    if (!id || !data.categories.some((item) => item.id === id)) throw new HttpError(404, "分类已不存在，请刷新后重试");
    return id;
  };
  const requireCharacter = (id: unknown) => {
    if (!Number.isSafeInteger(id) || !data.characters.some((item) => item.id === id)) throw new HttpError(404, "角色已不存在，请刷新后重试");
    return id as number;
  };
  const selectedNames = (characterId: number, input: Record<string, unknown>, existing?: CharacterMembership) => {
    const character = data.characters.find((item) => item.id === characterId)!;
    const displayName = text(input.displayName, "中文显示名", true)!;
    const originalName = text(input.originalName, "日文显示名", true)!;
    if ((!characterNameOptions(character, "zh").includes(displayName) && displayName !== existing?.displayName)
      || (!characterNameOptions(character, "ja").includes(originalName) && originalName !== existing?.originalName)) throw new HttpError(400, "请选择该角色已有的中文名和日文名");
    return { displayName: displayName === character.primaryName ? null : displayName, originalName: originalName === character.originalName ? null : originalName };
  };
  const children = (parentId: string | null) => sortCharacterNodes([
    ...data.categories.filter((item) => item.parentId === parentId).map((item) => ({ id: item.id, categoryId: item.id, characterId: null as number | null, sortOrder: item.sortOrder })),
    ...data.memberships.filter((item) => item.categoryId === parentId).map((item) => ({ id: characterMembershipKey(item.categoryId, item.characterId), categoryId: item.categoryId, characterId: item.characterId, sortOrder: item.sortOrder })),
  ]);
  const nextOrder = (parentId: string | null) => Math.max(-1, ...children(parentId).map((item) => item.sortOrder)) + 1;
  if (body.operation === "saveCategory") {
    if (body.categoryId != null && !category) throw new HttpError(404, "分类已不存在，请刷新后重试");
    const parentId = text(body.parentId, "上级分类", false, 240);
    if (parentId) requireCategory(parentId);
    if (category && parentId && characterNodeDescendants(data.categories, category.id).has(parentId)) throw new HttpError(400, "不能移动到自身或下级分类中");
    const id = categoryId ?? crypto.randomUUID();
    const label = text(body.label, "分类名称", true);
    const original = text(body.originalName, "日文原名");
    const source = normalizeHttpUrl(text(body.sourceUrl, "来源链接", false, 2048), "来源链接");
    const parentExpression = `CASE WHEN EXISTS(WITH RECURSIVE descendants(id) AS (SELECT ? UNION SELECT n.id FROM character_categories n JOIN descendants d ON n.parent_id=d.id) SELECT 1 FROM descendants WHERE id=?) THEN ? ELSE ? END`;
    const order = category?.parentId === parentId ? category.sortOrder : nextOrder(parentId);
    if (category) {
      const result = await database.prepare(`UPDATE character_categories SET parent_id=${parentExpression},label=?,original_name=?,source_url=?,sort_order=? WHERE id=?`)
        .bind(id,parentId,id,parentId,label,original,source,order,id).run();
      if (!result.meta.changes) throw new HttpError(409, "分类已不存在，请刷新后重试");
    } else {
      await database.prepare(`INSERT INTO character_categories(id,parent_id,label,original_name,source_url,sort_order) VALUES (?,?,?,?,?,?)`)
        .bind(id,parentId,label,original,source,order).run();
    }
    return { categoryId: id, characterId: null };
  }
  if (body.operation === "deleteCategory") {
    requireCategory(categoryId);
    if (children(categoryId).length) throw new HttpError(409, "请先移走分类内的子分类和角色");
    await database.prepare("DELETE FROM character_categories WHERE id=?").bind(categoryId).run();
    return { categoryId: category!.parentId, characterId: null };
  }
  if (body.operation === "addCharacters") {
    requireCategory(categoryId);
    if (!Array.isArray(body.characters) || !body.characters.length || body.characters.length > 100) throw new HttpError(400, "请选择 1 至 100 位角色及使用的名字");
    const selected = body.characters.map((input: unknown) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "角色选择格式不正确");
      const value = input as Record<string, unknown>;
      const characterId = requireCharacter(value.characterId);
      return { characterId, ...selectedNames(characterId, value) };
    });
    if (new Set(selected.map((item) => item.characterId)).size !== selected.length) throw new HttpError(400, "同一分类不能重复选择同一角色");
    const order = nextOrder(categoryId);
    await database.batch(selected.map((item, index) => database.prepare("INSERT INTO character_category_memberships(category_id,character_id,sort_order,display_name,original_name) VALUES (?,?,?,?,?) ON CONFLICT(category_id,character_id) DO NOTHING").bind(categoryId,item.characterId,order + index,item.displayName,item.originalName)));
    return { categoryId, characterId: selected.length === 1 ? selected[0].characterId : null };
  }
  if (body.operation === "saveMembership") {
    const characterId = requireCharacter(body.characterId);
    const target = requireCategory(text(body.targetCategoryId, "所属分类", true, 240));
    const existing = data.memberships.find((member) => member.categoryId === categoryId && member.characterId === characterId);
    if (!existing) throw new HttpError(409, "该角色的分类已变化，请刷新后重试");
    const names = selectedNames(characterId, body, existing);
    const statements: D1PreparedStatement[] = [];
    if (target !== categoryId) {
      if (categoryId && data.memberships.some((member) => member.categoryId === target && member.characterId === characterId)) throw new HttpError(409, "该角色已在目标分类中，可直接从当前分类移除");
      statements.push(database.prepare("UPDATE character_category_memberships SET category_id=?,sort_order=?,display_name=?,original_name=? WHERE category_id=? AND character_id=?").bind(target,nextOrder(target),names.displayName,names.originalName,categoryId,characterId));
    } else {
      statements.push(database.prepare("UPDATE character_category_memberships SET display_name=?,original_name=? WHERE category_id=? AND character_id=?").bind(names.displayName,names.originalName,categoryId,characterId));
    }
    await database.batch(statements);
    return { categoryId: target, characterId };
  }
  if (body.operation === "saveSources") {
    const characterId = requireCharacter(body.characterId);
    if (!Array.isArray(body.sourceUrls) || body.sourceUrls.length > 100) throw new HttpError(400, "来源链接格式不正确，最多 100 个");
    const urls = [...new Set(body.sourceUrls.map((url) => normalizeHttpUrl(text(url, "来源链接", true, 2048), "来源链接")!))];
    await database.batch([
      database.prepare("DELETE FROM character_sources WHERE character_id=?").bind(characterId),
      ...urls.map((url, order) => database.prepare("INSERT INTO character_sources(character_id,url,sort_order) VALUES (?,?,?)").bind(characterId,url,order)),
    ]);
    return { categoryId: data.memberships.find((member) => member.characterId === characterId)?.categoryId ?? null, characterId };
  }
  if (body.operation === "removeCharacter") {
    requireCategory(categoryId);
    const characterId = requireCharacter(body.characterId);
    await database.prepare("DELETE FROM character_category_memberships WHERE category_id=? AND character_id=?").bind(categoryId,characterId).run();
    return { categoryId, characterId: null };
  }
  if (body.operation === "reorder") {
    requireCategory(categoryId);
    const characterId = body.characterId == null ? null : requireCharacter(body.characterId);
    const parentId = characterId === null ? category!.parentId : categoryId;
    const siblings = children(parentId);
    const index = siblings.findIndex((item) => item.categoryId === categoryId && item.characterId === characterId);
    if (index < 0) throw new HttpError(409, "所属分类已变化，请刷新后重试");
    if (body.direction !== "up" && body.direction !== "down") throw new HttpError(400, "排序方向不正确");
    const target = index + (body.direction === "up" ? -1 : 1);
    if (target < 0 || target >= siblings.length) return { categoryId, characterId };
    [siblings[index],siblings[target]] = [siblings[target],siblings[index]];
    await database.batch(siblings.map((item, order) => item.characterId === null
      ? database.prepare("UPDATE character_categories SET sort_order=? WHERE id=? AND parent_id IS ?").bind(order,item.categoryId,parentId)
      : database.prepare("UPDATE character_category_memberships SET sort_order=? WHERE category_id=? AND character_id=?").bind(order,item.categoryId,item.characterId)));
    return { categoryId, characterId };
  }
  if (body.operation === "reorderTo") {
    requireCategory(categoryId);
    const characterId = requireCharacter(body.characterId);
    const targetCharacterId = requireCharacter(body.targetCharacterId);
    if (body.position !== "before" && body.position !== "after") throw new HttpError(400, "排序位置不正确");
    const parentId = categoryId;
    const siblings = children(parentId);
    const index = siblings.findIndex((item) => item.categoryId === categoryId && item.characterId === characterId);
    const target = siblings.findIndex((item) => item.categoryId === categoryId && item.characterId === targetCharacterId);
    if (index < 0 || target < 0) throw new HttpError(409, "分类成员已变化，请刷新后重试");
    if (index === target) return { categoryId, characterId: null };
    const [moved] = siblings.splice(index, 1);
    const insertAt = (target > index ? target - 1 : target) + (body.position === "after" ? 1 : 0);
    siblings.splice(insertAt, 0, moved);
    await database.batch(siblings.map((item, order) => item.characterId === null
      ? database.prepare("UPDATE character_categories SET sort_order=? WHERE id=? AND parent_id IS ?").bind(order,item.categoryId,parentId)
      : database.prepare("UPDATE character_category_memberships SET sort_order=? WHERE category_id=? AND character_id=?").bind(order,item.categoryId,item.characterId)));
    return { categoryId, characterId: null };
  }
  throw new HttpError(400, "不支持的分类操作");
}
