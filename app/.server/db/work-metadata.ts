import { normalizeSha256 } from "@/app/.server/crypto/sha256";
import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { readValidatedImage } from "@/app/.server/storage/work-images";
import { HttpError } from "@/lib/http";
import type { WorkSourceLink } from "@/lib/work-sources";

export function normalizeWorkMedia(cover: string, previews: string[], requireCover = true) {
  if (requireCover && !cover) throw new HttpError(400, "作品必须指定一张封面");
  if (typeof cover !== "string" || !Array.isArray(previews) || [...cover ? [cover] : [], ...previews].some((hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash.trim())))
    throw new HttpError(400, "封面或预览图哈希不合法");
  const coverBlobSha256 = cover ? normalizeSha256(cover) : "";
  return {
    coverBlobSha256,
    previewBlobSha256s: [...new Set(previews.map(normalizeSha256))].filter((hash) => hash !== coverBlobSha256),
  };
}

export async function validateWorkMedia(runtime: AppRuntime, hashes: string[]) {
  for (const hash of new Set(hashes)) {
    const active = await getD1(runtime).prepare("SELECT 1 FROM blobs WHERE sha256=? AND status='active'").bind(hash).first();
    if (!active) throw new HttpError(400, "图片对象不存在或不可用");
    await readValidatedImage(runtime, hash);
  }
}

export function workMediaStatements(database: D1Database, workId: number, cover: string, previews: string[]) {
  const media = normalizeWorkMedia(cover, previews, false);
  return [
    database.prepare("DELETE FROM work_media_assets WHERE work_id=?").bind(workId),
    ...[media.coverBlobSha256, ...media.previewBlobSha256s].filter(Boolean).flatMap((hash, index) => [
      database.prepare("INSERT OR IGNORE INTO media_assets(blob_sha256) VALUES(?)").bind(hash),
      database.prepare("INSERT INTO work_media_assets(work_id,media_asset_id,sort_order,role) SELECT ?,id,?,? FROM media_assets WHERE blob_sha256=?")
        .bind(workId, index, hash === media.coverBlobSha256 ? "cover" : "preview", hash),
    ]),
  ];
}

// A full editable set is independent of provenance. Keep provenance on unchanged rows.
export function workTagStatements(database: D1Database, workId: number, tags: string[], source: "admin" | "uploader") {
  return [
    database.prepare(`DELETE FROM work_tags WHERE work_id=? AND tag_id NOT IN
      (SELECT t.id FROM tags t JOIN json_each(?) submitted ON t.name=submitted.value COLLATE NOCASE)`)
      .bind(workId, JSON.stringify(tags)),
    ...tags.flatMap((tag) => [
      database.prepare("INSERT OR IGNORE INTO tags(name,namespace) VALUES(?,'other')").bind(tag),
      database.prepare("INSERT OR IGNORE INTO work_tags(work_id,tag_id,source) SELECT ?,id,? FROM tags WHERE name=? COLLATE NOCASE").bind(workId, source, tag),
    ]),
  ];
}

export function workSourceStatements(database: D1Database, workId: number, sources: WorkSourceLink[]) {
  return [
    database.prepare("DELETE FROM work_external_links WHERE work_id=? AND link_type='source'").bind(workId),
    ...sources.map((link) => database.prepare("INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?,?,?,'source')").bind(workId, link.label, link.url)),
  ];
}
