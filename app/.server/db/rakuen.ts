import type { AppRuntime } from "@/app/.server/runtime";
import { topicTags } from "@/app/.server/forum/queries";
import {
  CHARACTER_PORTRAIT_COLUMNS,
  DEFAULT_CHARACTER_PORTRAIT_JOINS,
  PUBLIC_CHARACTER_PORTRAIT_CONDITION,
  mapCharacterPortrait,
  type CharacterPortraitRow,
} from "./character-portrait-library";
import { getD1 } from "./d1";

const queries = {
  topic: `SELECT 'topic' AS kind,t.id,t.title,t.reply_count AS count,
    MAX(t.created_at,t.last_activity_at) AS activeAt FROM forum_public_topics t`,
  work: `SELECT 'work' AS kind,w.id,COALESCE(w.chinese_title,w.original_title) AS title,
    COUNT(*) AS count,MAX(c.created_at) AS activeAt
    FROM comments c JOIN public_works w ON w.id=c.work_id GROUP BY w.id`,
  creator: `SELECT 'creator' AS kind,cr.id,cr.name AS title,
    COUNT(*) AS count,MAX(c.created_at) AS activeAt
    FROM comments c JOIN creators cr ON cr.id=c.creator_id
    WHERE cr.public_at IS NOT NULL GROUP BY cr.id`,
  character: `SELECT 'character' AS kind,ch.id,ch.primary_name AS title,
    COUNT(*) AS count,MAX(c.created_at) AS activeAt
    FROM comments c JOIN characters ch ON ch.id=c.character_id GROUP BY ch.id`,
};

type Kind = keyof typeof queries;
type Row = CharacterPortraitRow & {
  kind: Kind;
  id: number;
  title: string;
  count: number;
  activeAt: string;
  coverBlobSha256: string | null;
  avatarBlobSha256: string | null;
  imageName: string;
};

const paths = {
  topic: "discussions",
  work: "games",
  creator: "creators",
  character: "characters",
};

export async function listRakuenPages(
  runtime: AppRuntime,
  requestedType: string,
  requestedPage: number,
) {
  const type = Object.hasOwn(queries, requestedType)
    ? (requestedType as Kind)
    : "all";
  // ponytail: read existing history instead of maintaining another activity table.
  // Counts and times include removed comments; only the source page must be public.
  const query = type === "all"
    ? Object.values(queries).join(" UNION ALL ")
    : queries[type];
  const database = getD1(runtime);
  const count = await database
    .prepare(`SELECT COUNT(*) AS total FROM (${query})`)
    .first<{ total: number }>();
  const total = count?.total ?? 0;
  const pageSize = 40;
  const page = Math.min(
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    Math.max(1, Math.ceil(total / pageSize)),
  );
  const rows = await database
    .prepare(`SELECT page.*,
      (SELECT ma.blob_sha256 FROM work_media_assets wma
        JOIN media_assets ma ON ma.id=wma.media_asset_id
        WHERE page.kind='work' AND wma.work_id=page.id AND wma.role='cover'
        ORDER BY wma.sort_order LIMIT 1) AS coverBlobSha256,
      CASE WHEN page.kind='topic' THEN
        CASE WHEN u.status='active' THEN u.avatar_blob_sha256 END
        ELSE cr.avatar_blob_sha256 END AS avatarBlobSha256,
      CASE WHEN u.status='deleted' THEN '账户已注销'
        ELSE COALESCE(u.display_name,page.title) END AS imageName,
      ${CHARACTER_PORTRAIT_COLUMNS}
      FROM (SELECT * FROM (${query})
        ORDER BY activeAt DESC,kind ASC,id DESC LIMIT ? OFFSET ?) page
      LEFT JOIN forum_topics t ON page.kind='topic' AND t.id=page.id
      LEFT JOIN users u ON u.id=t.user_id
      LEFT JOIN creators cr ON page.kind='creator' AND cr.id=page.id
      LEFT JOIN characters ch ON page.kind='character' AND ch.id=page.id
      ${DEFAULT_CHARACTER_PORTRAIT_JOINS} AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}
      ORDER BY page.activeAt DESC,page.kind ASC,page.id DESC`)
    .bind(pageSize, (page - 1) * pageSize)
    .all<Row>();
  const tags = await topicTags(runtime, rows.results
    .filter((row) => row.kind === "topic").map((row) => row.id));
  return {
    type,
    page,
    pageSize,
    total,
    items: rows.results.map((row) => {
      const entryHref = `/${paths[row.kind]}/${row.id}`;
      return {
        kind: row.kind,
        id: row.id,
        title: row.title,
        count: row.count,
        activeAt: row.activeAt,
        coverBlobSha256: row.coverBlobSha256,
        avatarBlobSha256: row.avatarBlobSha256,
        imageName: row.imageName,
        portrait: mapCharacterPortrait(row),
        tags: row.kind === "topic" ? tags.get(row.id) ?? [] : [],
        entryHref,
        href: entryHref,
      };
    }),
  };
}
