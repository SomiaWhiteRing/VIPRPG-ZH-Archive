import { manifestKey } from "../../../lib/archive/object-keys";
import type { ArchiveManifest } from "../../../lib/archive/manifest";
import { sameWebPlayZip } from "../../../lib/archive/web-play-zip";
import { sha256Hex } from "../../../lib/sha256";

async function readManifest(bucket: R2Bucket, hash: string): Promise<ArchiveManifest | null> {
  const object = await bucket.get(manifestKey(hash));
  if (!object) return null;
  const text = await object.text();
  if (await sha256Hex(new TextEncoder().encode(text).buffer) !== hash) throw new Error("Manifest SHA-256 mismatch");
  const manifest = JSON.parse(text);
  if (manifest?.schema !== "viprpg-archive.manifest.v1" || !manifest.archiveVersion) throw new Error("Invalid archive manifest");
  return manifest;
}

export async function loadManifest(bucket: R2Bucket, hash: string): Promise<ArchiveManifest> {
  const manifest = await readManifest(bucket, hash);
  if (!manifest) throw new Error(`Missing manifest object: ${hash}`);
  return manifest;
}

type RevisionRow = { previous_manifest_sha256: string | null; web_play_revision: string | null };

// The trigger only records in-place edits. Resolve each pending edit from its verified manifests.
// The archive-scoped primary key also preserves verified identities when a manifest is restored.
export async function resolveWebPlayRevision(db: D1Database, bucket: R2Bucket, archiveId: number,
  hash: string, previous: string | null, revision: string | null): Promise<string> {
  if (revision || !previous) return revision ?? hash;
  const before = await readManifest(bucket, previous);
  let next = hash;
  if (before && sameWebPlayZip(before, await loadManifest(bucket, hash))) {
    const parent = await db.prepare(`SELECT previous_manifest_sha256,web_play_revision FROM archive_web_play_revisions
      WHERE archive_version_id=? AND manifest_sha256=?`).bind(archiveId, previous).first<RevisionRow>();
    next = await resolveWebPlayRevision(db, bucket, archiveId, previous,
      parent?.previous_manifest_sha256 ?? null, parent?.web_play_revision ?? null);
  }
  await db.prepare(`UPDATE archive_web_play_revisions SET web_play_revision=?
    WHERE archive_version_id=? AND manifest_sha256=? AND web_play_revision IS NULL`).bind(next, archiveId, hash).run();
  return next;
}
