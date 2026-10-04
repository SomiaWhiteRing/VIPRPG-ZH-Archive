import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { PermissionKey } from "@/lib/authz/permissions";
import { characterNameKey, type CharacterCreditSelection } from "@/lib/character-names";

export type AuditTarget = {
  type: "work" | "creator" | "character" | "category" | "tag";
  id: string | number;
};

export type AuditSnapshot = { sql: string; binds: (string | number | null)[] };

// Both snapshots are read inside the mutation's D1 transaction. Reading the old
// value before batch() would misattribute a concurrent editor's changes.
export async function auditedEntityBatch(
  database: D1Database,
  statements: D1PreparedStatement[],
  input: {
    actor: ArchiveUser;
    eventType: string;
    targets: AuditTarget[] | "character";
    snapshot: AuditSnapshot;
    permission: PermissionKey | null;
    source: "admin" | "public" | "owned";
    operation?: string;
    context?: Record<string, unknown>;
  },
): Promise<D1Result[]> {
  const editId = crypto.randomUUID();
  const { actor, snapshot } = input;
  const targetsSql = `json((SELECT json_group_array(json_object('type',json_extract(value,'$.type'),'id',json_extract(value,'$.id'),
    'name',CASE json_extract(value,'$.type')
      WHEN 'work' THEN (SELECT COALESCE(chinese_title,original_title) FROM works WHERE id=json_extract(value,'$.id'))
      WHEN 'creator' THEN (SELECT name FROM creators WHERE id=json_extract(value,'$.id'))
      WHEN 'character' THEN (SELECT primary_name FROM characters WHERE id=json_extract(value,'$.id'))
      WHEN 'category' THEN (SELECT label FROM character_categories WHERE id=json_extract(value,'$.id'))
      WHEN 'tag' THEN json_extract(value,'$.id') END)) FROM json_each(?)))`;
  const result = await database.batch([
    database.prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
      VALUES(?,?,?,json_object('auditVersion',1,'editId',?,'targets',${targetsSql},
        'source',?,'operation',?,'context',json(?),'actor',json(?),'authorization',json(?),
        'before',json((${snapshot.sql}))))`)
      .bind(actor.id, actor.email, input.eventType, editId, JSON.stringify(Array.isArray(input.targets) ? input.targets : []),
        input.source, input.operation ?? null,
        JSON.stringify(input.context ?? {}),
        JSON.stringify({ userId: actor.id, displayName: actor.displayName, roleKeys: actor.roleKeys, roleNames: actor.roleNames }),
        JSON.stringify({ permission: input.permission, basis: input.permission === null ? "work_maintainer" : "permission",
          permissionKeys: actor.permissionKeys, isBootstrapAdmin: actor.isBootstrapAdmin }),
        ...snapshot.binds),
    ...statements,
    database.prepare(`UPDATE auth_audit_logs SET detail_json=json_set(detail_json,'$.after',json((${snapshot.sql})))
      WHERE id=(SELECT id FROM auth_audit_logs WHERE event_type=? AND json_extract(detail_json,'$.editId')=? ORDER BY id DESC LIMIT 1)`)
      .bind(...snapshot.binds, input.eventType, editId),
    ...(input.targets === "character" ? [database.prepare(`UPDATE auth_audit_logs SET detail_json=json_set(detail_json,'$.targets',
      json_array(json_object('type','character','id',json_extract(detail_json,'$.after.id'),'name',json_extract(detail_json,'$.after.primaryName'))))
      WHERE id=(SELECT id FROM auth_audit_logs WHERE event_type=? AND json_extract(detail_json,'$.editId')=? ORDER BY id DESC LIMIT 1)`)
      .bind(input.eventType, editId)] : []),
    ...(Array.isArray(input.targets) && input.targets.some((target) => target.type === "work") ? [database.prepare(`UPDATE auth_audit_logs SET detail_json=json_set(detail_json,'$.targets',
      json((SELECT json_group_array(json(target)) FROM (
        SELECT value AS target FROM json_each(detail_json,'$.targets')
        UNION ALL SELECT json_object('type','character','id',json_extract(c.value,'$.id'),'name',json_extract(c.value,'$.primaryName'))
        FROM json_each(detail_json,'$.after.relatedCharacters') c
        WHERE NOT EXISTS(SELECT 1 FROM json_each(detail_json,'$.targets') t WHERE json_extract(t.value,'$.type')='character' AND json_extract(t.value,'$.id')=json_extract(c.value,'$.id'))))))
      WHERE id=(SELECT id FROM auth_audit_logs WHERE event_type=? AND json_extract(detail_json,'$.editId')=? ORDER BY id DESC LIMIT 1)`)
      .bind(input.eventType, editId)] : []),
    // Saving identical business values is not evidence of an edit. Ignore
    // timestamps and regenerated internal row IDs in the snapshot definitions.
    database.prepare(`DELETE FROM auth_audit_logs WHERE id=(SELECT id FROM auth_audit_logs WHERE event_type=? AND json_extract(detail_json,'$.editId')=? ORDER BY id DESC LIMIT 1)
      AND json_extract(detail_json,'$.before') IS json_extract(detail_json,'$.after')`)
      .bind(input.eventType, editId),
  ]);
  return result.slice(1, 1 + statements.length);
}

export function creatorAuditSnapshot(id: number, includeWorks = false): AuditSnapshot {
  return { sql: `SELECT json_object('id',id,'name',name,'links',json(links_json),
    'bio',json_extract(extra_json,'$.bio'),'avatarBlobSha256',avatar_blob_sha256,
    'aliases',json((SELECT json_group_array(name) FROM (SELECT name FROM creator_aliases WHERE creator_id=c.id ORDER BY name)))
    ${includeWorks ? `,'workCredits',json((SELECT json_group_array(json_object('workId',work_id,'displayName',display_name,'roleKey',role_key,'roleLabel',role_label,'notes',notes,'sortOrder',sort_order))
      FROM (SELECT * FROM work_staff WHERE creator_id=c.id ORDER BY work_id,role_key)))` : ""})
    FROM creators c WHERE id=?`, binds: [id] };
}

export function characterAuditSnapshot(id: number, includeWorks = false): AuditSnapshot {
  return { sql: `SELECT json_object('id',id,'primaryName',primary_name,'originalName',original_name,'description',description,
    'aliases',json((SELECT json_group_array(json_object('name',name,'language',language)) FROM
      (SELECT name,language FROM character_aliases WHERE character_id=c.id ORDER BY language,name))),
    'sources',json((SELECT json_group_array(url) FROM (SELECT url FROM character_sources WHERE character_id=c.id ORDER BY sort_order,url))),
    'memberships',json((SELECT json_group_array(json_object('categoryId',category_id,'displayName',display_name,'originalName',original_name,'sortOrder',sort_order)) FROM
      (SELECT * FROM character_category_memberships WHERE character_id=c.id ORDER BY category_id))),
    'faceSheets',json((SELECT json_group_array(json_object('id',fs.id,'sha256',fs.blob_sha256,'status',fs.library_status,'sortOrder',b.sort_order))
      FROM (SELECT * FROM character_face_sheet_bindings WHERE character_id=c.id ORDER BY sort_order,face_sheet_id) b JOIN face_sheets fs ON fs.id=b.face_sheet_id)),
    'defaultPortrait',json((SELECT json_object('sha256',fs.blob_sha256,'row',r.cell_row,'column',r.cell_column)
      FROM character_default_portraits d JOIN character_portrait_refs r ON r.id=d.portrait_ref_id JOIN face_sheets fs ON fs.id=r.face_sheet_id WHERE d.character_id=c.id)),
    'materials',json((SELECT json_group_array(json_object('id',m.id,'sha256',m.blob_sha256,'kind',m.kind,'sortOrder',b.sort_order))
      FROM (SELECT * FROM character_material_bindings WHERE character_id=c.id ORDER BY sort_order,material_id) b JOIN character_materials m ON m.id=b.material_id))
    ${includeWorks ? `,'workCredits',json((SELECT json_group_array(json_object('workId',work_id,'displayName',display_name,'roleKey',role_key,'spoilerLevel',spoiler_level,'sortOrder',sort_order,'notes',notes))
      FROM (SELECT * FROM work_characters WHERE character_id=c.id ORDER BY work_id,sort_order,id)))` : ""}) FROM characters c WHERE id=?`, binds: [id] };
}

export function combinedAuditSnapshot(snapshots: Record<string, AuditSnapshot>): AuditSnapshot {
  const entries = Object.entries(snapshots);
  return { sql: `SELECT json_object(${entries.map(([, snapshot]) => `?,json((${snapshot.sql}))`).join(",")})`,
    binds: entries.flatMap(([key, snapshot]) => [key, ...snapshot.binds]) };
}

export function workAuditSnapshot(id: number, includeRelations = false): AuditSnapshot {
  return { sql: `SELECT json_object('id',id,'originalTitle',original_title,'chineseTitle',chinese_title,'description',description,
    'genre',genre,'referenceDuration',json_extract(extra_json,'$.referenceDuration'),'moreInfo',json_extract(extra_json,'$.moreInfo'),'usesUnsupportedManiac',json_extract(extra_json,'$.usesUnsupportedManiac'),
    'originalReleaseDate',original_release_date,'releasePrecision',original_release_precision,'engineFamily',engine_family,
    'isOriginal',is_original,'isTranslation',is_translation,'language',language,'status',status,
    'aliases',json((SELECT json_group_array(title) FROM (SELECT title FROM work_titles WHERE work_id=w.id ORDER BY title))),
    'staff',json((SELECT json_group_array(json_object('creatorId',creator_id,'creatorName',(SELECT name FROM creators WHERE id=creator_id),'displayName',display_name,'roleKey',role_key,'roleLabel',role_label,'notes',notes,'sortOrder',sort_order))
      FROM (SELECT * FROM work_staff WHERE work_id=w.id ORDER BY sort_order,creator_id,role_key))),
    'characters',json((SELECT json_group_array(json_object('characterId',wc.character_id,'displayName',wc.display_name,'roleKey',wc.role_key,'spoilerLevel',wc.spoiler_level,'sortOrder',wc.sort_order,'notes',wc.notes,
      'portrait',json(CASE WHEN fs.id IS NULL THEN NULL ELSE json_object('sha256',fs.blob_sha256,'row',r.cell_row,'column',r.cell_column) END)))
      FROM (SELECT * FROM work_characters WHERE work_id=w.id ORDER BY sort_order,id) wc
      LEFT JOIN character_portrait_refs r ON r.id=wc.portrait_ref_id LEFT JOIN face_sheets fs ON fs.id=r.face_sheet_id)),
    'tags',json((SELECT json_group_array(tag_name) FROM (SELECT tag_name FROM work_tags WHERE work_id=w.id ORDER BY sort_order,tag_name))),
    'media',json((SELECT json_group_array(json_object('sha256',m.blob_sha256,'role',a.role,'sortOrder',a.sort_order))
      FROM (SELECT * FROM work_media_assets WHERE work_id=w.id ORDER BY role,sort_order,media_asset_id) a JOIN media_assets m ON m.id=a.media_asset_id)),
    'externalLinks',json((SELECT json_group_array(json_object('label',label,'url',url,'type',link_type))
      FROM (SELECT * FROM work_external_links WHERE work_id=w.id ORDER BY id))),
    'currentArchives',json((SELECT json_group_array(json_object('id',id,'sourceUrl',source_url)) FROM (SELECT id,source_url FROM archive_versions WHERE work_id=w.id AND is_current=1 ORDER BY id)))
    ${includeRelations ? `,'relations',json((SELECT json_group_array(json_object('id',id,'fromWorkId',from_work_id,'toWorkId',to_work_id,'type',relation_type,'inverse',vice_versa))
      FROM (SELECT * FROM work_relations WHERE from_work_id=w.id OR to_work_id=w.id ORDER BY id))),
      'translationRelations',json((SELECT json_group_array(json_object('id',id,'fromWorkId',source_work_id,'toWorkId',target_work_id,'type',target_role,'inverse',vice_versa))
      FROM (SELECT * FROM translation_relations WHERE source_work_id=w.id OR target_work_id=w.id ORDER BY id))),
      'maintainers',json((SELECT json_group_array(user_id) FROM (SELECT user_id FROM work_uploaders WHERE work_id=w.id ORDER BY user_id)))` : ""})
    FROM works w WHERE id=?`, binds: [id] };
}

// Work editors can also register a character or bind sheets to an existing
// character. Capture those global effects even for a newly selected credit.
export function workEditAuditSnapshot(id: number, credits: CharacterCreditSelection[], previousCharacterIds: number[]): AuditSnapshot {
  const ids = [...new Set([...previousCharacterIds, ...credits.flatMap((credit) => credit.selection.kind === "existing" ? [credit.selection.characterId] : [])])];
  const keys = [...new Set(credits.flatMap((credit) => credit.selection.kind === "new" ? [characterNameKey(credit.selection.originalName)] : []))];
  const character = characterAuditSnapshot(0);
  const snapshot = character.sql.replace("WHERE id=?", "WHERE c.id=affected.id");
  return combinedAuditSnapshot({ work: workAuditSnapshot(id), relatedCharacters: {
    sql: `SELECT json_group_array(json((${snapshot}))) FROM (SELECT id FROM characters WHERE id IN (SELECT value FROM json_each(?))
      OR original_name_key IN (SELECT value FROM json_each(?)) OR id IN (SELECT character_id FROM character_aliases WHERE language='ja' AND name_key IN (SELECT value FROM json_each(?))) ORDER BY id) affected`,
    binds: [JSON.stringify(ids), JSON.stringify(keys), JSON.stringify(keys)],
  } });
}

export function tagAuditSnapshot(name: string): AuditSnapshot {
  return { sql: "SELECT json_object('name',name,'namespace',namespace,'description',description) FROM tags WHERE name=?", binds: [name] };
}

export function classificationAuditSnapshot(categoryIds: string[], characterIds: number[], siblingParent?: string | null): AuditSnapshot {
  const categories = JSON.stringify(categoryIds);
  const characters = JSON.stringify(characterIds);
  return { sql: `SELECT json_object(
    'categories',json((SELECT json_group_array(json_object('id',id,'parentId',parent_id,'label',label,'originalName',original_name,'sourceUrl',source_url,'sortOrder',sort_order))
      FROM (SELECT * FROM character_categories WHERE id IN (SELECT value FROM json_each(?)) ${siblingParent !== undefined ? "OR parent_id IS ?" : ""} ORDER BY id))),
    'memberships',json((SELECT json_group_array(json_object('categoryId',category_id,'characterId',character_id,'displayName',display_name,'originalName',original_name,'sortOrder',sort_order))
      FROM (SELECT * FROM character_category_memberships WHERE category_id IN (SELECT value FROM json_each(?)) OR character_id IN (SELECT value FROM json_each(?)) ORDER BY category_id,character_id))),
    'sources',json((SELECT json_group_array(json_object('characterId',character_id,'url',url,'sortOrder',sort_order))
      FROM (SELECT * FROM character_sources WHERE character_id IN (SELECT value FROM json_each(?)) ORDER BY character_id,sort_order,url))))`,
    binds: [categories, ...(siblingParent !== undefined ? [siblingParent] : []), categories, characters, characters] };
}

export function relationAuditSnapshot(from: number, to: number, translation = false): AuditSnapshot {
  const table = translation ? "translation_relations" : "work_relations";
  const fromColumn = translation ? "source_work_id" : "from_work_id";
  const toColumn = translation ? "target_work_id" : "to_work_id";
  const typeColumn = translation ? "target_role" : "relation_type";
  return { sql: `SELECT json_object('relations',json((SELECT json_group_array(json_object('id',id,'fromWorkId',${fromColumn},'toWorkId',${toColumn},'type',${typeColumn},'inverse',vice_versa,'createdByUserId',created_by_user_id))
    FROM (SELECT * FROM ${table} WHERE (${fromColumn}=? AND ${toColumn}=?) OR (${fromColumn}=? AND ${toColumn}=?) ORDER BY id))))`,
    binds: [from, to, to, from] };
}
