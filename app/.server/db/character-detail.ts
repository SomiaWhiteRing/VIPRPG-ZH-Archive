import type { CharacterPortraitRow } from "@/app/.server/db/character-portrait-library";
import {
  CHARACTER_PORTRAIT_COLUMNS,
  DEFAULT_CHARACTER_PORTRAIT_JOINS,
  PUBLIC_CHARACTER_PORTRAIT_CONDITION,
  mapCharacterPortrait,
} from "@/app/.server/db/character-portrait-library";
import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import type { CharacterCategory } from "@/lib/character-index";
import { characterNodePath } from "@/lib/character-index";
import type { CharacterMaterial } from "@/lib/character-materials";
import type { CharacterAliasSuggestion } from "@/lib/character-names";
import type {
  CharacterWork,
  CharacterWorkCredit,
} from "@/lib/dto/db/character-detail";

type DetailRow = CharacterPortraitRow & {
  id: number;
  primaryName: string;
  originalName: string;
};

export async function getPublicCharacterDetail(
  runtime: AppRuntime,
  id: number,
) {
  const db = getD1(runtime);
  const row = await db
    .prepare(
      `SELECT ch.id,ch.primary_name AS primaryName,
    ch.original_name AS originalName,${CHARACTER_PORTRAIT_COLUMNS}
    FROM characters ch ${DEFAULT_CHARACTER_PORTRAIT_JOINS}
      AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}
    WHERE ch.id=? LIMIT 1`,
    )
    .bind(id)
    .first<DetailRow>();
  if (!row) return null;

  const [aliases, sources, categories, memberships, works, faces, materials] =
    await db.batch([
      db
        .prepare(
          "SELECT name,language FROM character_aliases WHERE character_id=? ORDER BY language,name",
        )
        .bind(id),
      db
        .prepare(
          "SELECT url FROM character_sources WHERE character_id=? ORDER BY sort_order,url",
        )
        .bind(id),
      db.prepare(
        "SELECT id,parent_id AS parentId,label FROM character_categories",
      ),
      db
        .prepare(
          "SELECT category_id AS categoryId FROM character_category_memberships WHERE character_id=? ORDER BY category_id",
        )
        .bind(id),
      db
        .prepare(
          `SELECT w.id,wc.id AS creditId,COALESCE(w.chinese_title,w.original_title) AS title,w.original_title AS originalTitle,
      wc.display_name AS displayName,wc.role_key AS roleKey,wc.spoiler_level AS spoilerLevel,wc.notes,
      w.original_release_date AS releaseDate,
      (SELECT ma.blob_sha256 FROM work_media_assets wma JOIN media_assets ma ON ma.id=wma.media_asset_id
       WHERE wma.work_id=w.id AND ma.kind='preview' ORDER BY wma.is_primary DESC,wma.sort_order LIMIT 1) AS previewBlobSha256
      FROM work_characters wc JOIN works w ON w.id=wc.work_id
      WHERE wc.character_id=? AND w.status='published'
      ORDER BY COALESCE(w.original_release_date,w.published_at,w.created_at) DESC,w.original_title,w.id,wc.sort_order,wc.id`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT 'faceset:' || fs.id AS id,'faceset' AS kind,fs.blob_sha256 AS blobSha256,fs.width_px AS width,fs.height_px AS height
      FROM character_face_sheet_bindings binding JOIN face_sheets fs ON fs.id=binding.face_sheet_id
      JOIN blobs b ON b.sha256=fs.blob_sha256
      WHERE binding.character_id=? AND fs.library_status='approved' AND b.status='active' AND b.content_type_hint LIKE 'image/%'
      ORDER BY binding.sort_order IS NULL,binding.sort_order,fs.source_order IS NULL,fs.source_order,fs.id`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT 'material:' || m.id AS id,m.kind,m.blob_sha256 AS blobSha256,m.width_px AS width,m.height_px AS height
      FROM character_material_bindings binding JOIN character_materials m ON m.id=binding.material_id
      JOIN blobs b ON b.sha256=m.blob_sha256
      WHERE binding.character_id=? AND b.status='active' AND b.content_type_hint LIKE 'image/%'
      ORDER BY m.kind,binding.sort_order IS NULL,binding.sort_order,m.id`,
        )
        .bind(id),
    ]);
  const groupedWorks = new Map<number, CharacterWork>();
  for (const credit of works.results as CharacterWorkCredit[]) {
    const work = groupedWorks.get(credit.id);
    if (work) work.credits.push(credit);
    else groupedWorks.set(credit.id, { ...credit, credits: [credit] });
  }
  return {
    id: row.id,
    primaryName: row.primaryName,
    originalName: row.originalName,
    portrait: mapCharacterPortrait(row),
    aliases: aliases.results as CharacterAliasSuggestion[],
    sourceUrls: (sources.results as { url: string }[]).map(
      (source) => source.url,
    ),
    categories: (memberships.results as { categoryId: string }[]).map(
      (membership) => ({
        id: membership.categoryId,
        path: characterNodePath(
          categories.results as CharacterCategory[],
          membership.categoryId,
        ),
      }),
    ),
    works: [...groupedWorks.values()],
    materials: [...faces.results, ...materials.results] as CharacterMaterial[],
  };
}
