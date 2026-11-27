import type { AppRuntime } from "@/app/.server/runtime";
import { getArchiveNetplayEndpoint, type ArchiveDownloadRecord } from "@/app/.server/db/archive-downloads";
import { resolveWebPlayRevision } from "../storage/web-play-revision";
import { getD1 } from "../db/d1";
import { getArchiveBucket, readArchiveEasyRpgConfig } from "@/app/.server/storage/archive-bucket";
import type { WebPlayMetadata } from "@/app/play/[workId]/web-play-types";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import {
  buildWebPlayDownloadUrl, buildWebPlayKey, easyRpgRuntimeBasePath,
  easyRpgRuntimeAssetBasePath, easyRpgRuntimeVersion, webPlayInstallerVersion,
} from "@/lib/archive/web-play";

export async function readWebPlayMetadata(runtime: AppRuntime, record: ArchiveDownloadRecord, revisionAware = true): Promise<WebPlayMetadata> {
  const easyRpg = await readArchiveEasyRpgConfig(runtime, record.manifestSha256);
  const db = getD1(runtime);
  const revision = await resolveWebPlayRevision(db, getArchiveBucket(runtime), record.id,
    record.manifestSha256, record.previousManifest, record.webPlayRevision);
  const aliases = revisionAware && (record.previousManifest || record.webPlayRevision) ? (await db.prepare(
    "SELECT manifest_sha256 FROM archive_web_play_revisions WHERE archive_version_id=? AND web_play_revision=? AND manifest_sha256<>?"
  ).bind(record.id, revision, revision).all<{ manifest_sha256: string }>()).results.map(row => row.manifest_sha256) : [];
  return {
    ok: true, archiveVersionId: record.id, workId: record.workId,
    title: record.workChineseTitle || record.workOriginalTitle,
    originalTitle: record.workOriginalTitle, chineseTitle: record.workChineseTitle,
    coverBlobSha256: record.workCoverBlobSha256,
    manifestSha256: record.manifestSha256, downloadZipBuilderVersion, webPlayInstallerVersion,
    easyRpgRuntimeVersion, runtimeBasePath: easyRpgRuntimeBasePath,
    runtimeAssetBasePath: easyRpgRuntimeAssetBasePath(runtime.origin),
    webPlayRevision: revision,
    ...(aliases.length ? { equivalentManifests: aliases } : {}),
    playKey: buildWebPlayKey({ archiveVersionId: record.id, manifestSha256: revisionAware ? revision : record.manifestSha256 }),
    downloadUrl: buildWebPlayDownloadUrl(record.id, record.previousManifest || record.webPlayRevision ? record.manifestSha256 : null),
    totalFiles: record.totalFiles, totalSizeBytes: record.totalSizeBytes,
    installTotalFiles: record.installTotalFiles, installTotalSizeBytes: record.installTotalSizeBytes,
    estimatedR2GetCount: record.estimatedR2GetCount, engineFamily: record.engineFamily, easyRpg,
    netplayEndpoint: easyRpg?.netplay ? await getArchiveNetplayEndpoint(runtime, record) : undefined,
  };
}
