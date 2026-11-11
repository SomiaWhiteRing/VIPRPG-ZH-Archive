import type { AppRuntime } from "@/app/.server/runtime";
import { getArchiveNetplayEndpoint, type ArchiveDownloadRecord } from "@/app/.server/db/archive-downloads";
import { readArchiveEasyRpgConfig } from "@/app/.server/storage/archive-bucket";
import type { WebPlayMetadata } from "@/app/play/[workId]/web-play-types";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import {
  buildWebPlayDownloadUrl, buildWebPlayKey, easyRpgRuntimeBasePath,
  easyRpgRuntimeAssetBasePath, easyRpgRuntimeVersion, webPlayInstallerVersion,
} from "@/lib/archive/web-play";

export async function readWebPlayMetadata(runtime: AppRuntime, record: ArchiveDownloadRecord): Promise<WebPlayMetadata> {
  const easyRpg = await readArchiveEasyRpgConfig(runtime, record.manifestSha256);
  return {
    ok: true, archiveVersionId: record.id, workId: record.workId,
    title: record.workChineseTitle || record.workOriginalTitle,
    originalTitle: record.workOriginalTitle, chineseTitle: record.workChineseTitle,
    coverBlobSha256: record.workCoverBlobSha256,
    manifestSha256: record.manifestSha256, downloadZipBuilderVersion, webPlayInstallerVersion,
    easyRpgRuntimeVersion, runtimeBasePath: easyRpgRuntimeBasePath,
    runtimeAssetBasePath: easyRpgRuntimeAssetBasePath(runtime.origin),
    playKey: buildWebPlayKey({ archiveVersionId: record.id, manifestSha256: record.manifestSha256 }),
    downloadUrl: buildWebPlayDownloadUrl(record.id),
    totalFiles: record.totalFiles, totalSizeBytes: record.totalSizeBytes,
    installTotalFiles: record.installTotalFiles, installTotalSizeBytes: record.installTotalSizeBytes,
    estimatedR2GetCount: record.estimatedR2GetCount, engineFamily: record.engineFamily, easyRpg,
    netplayEndpoint: easyRpg?.netplay ? await getArchiveNetplayEndpoint(runtime, record) : undefined,
  };
}
