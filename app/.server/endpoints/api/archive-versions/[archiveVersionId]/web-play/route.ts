import {
  getPublishedArchiveDownloadRecord,
  getWebPlayInstallTargetTotals,
  parseArchiveVersionId,
} from "@/app/.server/db/archive-downloads";
import type { AppRuntime } from "@/app/.server/runtime";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import {
  buildArchiveDownloadUrl,
  buildWebPlayKey,
  easyRpgRuntimeBasePath,
  easyRpgRuntimeVersion,
  webPlayInstallerVersion,
} from "@/lib/archive/web-play";
import { json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    archiveVersionId: string;
  };
};

export async function GET(
  runtime: AppRuntime,
  _request: Request,
  context: RouteContext,
) {
  try {
    const { archiveVersionId: rawArchiveVersionId } = await context.params;
    const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
    const record = await getPublishedArchiveDownloadRecord(
      runtime,
      archiveVersionId,
    );

    if (!record) {
      return json(
        {
          ok: false,
          error: "Archive version not found",
        },
        { status: 404 },
      );
    }

    const installTarget = await getWebPlayInstallTargetTotals(
      runtime,
      record.id,
    );
    const playKey = buildWebPlayKey({
      archiveVersionId: record.id,
      manifestSha256: record.manifestSha256,
    });

    return json({
      ok: true,
      archiveVersionId: record.id,
      workId: record.workId,
      title: record.workChineseTitle || record.workOriginalTitle,
      originalTitle: record.workOriginalTitle,
      chineseTitle: record.workChineseTitle,
      coverBlobSha256: record.workCoverBlobSha256,
      manifestSha256: record.manifestSha256,
      downloadZipBuilderVersion,
      webPlayInstallerVersion,
      easyRpgRuntimeVersion,
      runtimeBasePath: easyRpgRuntimeBasePath,
      playKey,
      downloadUrl: buildArchiveDownloadUrl(record.id),
      totalFiles: record.totalFiles,
      totalSizeBytes: record.totalSizeBytes,
      installTotalFiles: installTarget.totalFiles,
      installTotalSizeBytes: installTarget.totalSizeBytes,
      estimatedR2GetCount: record.estimatedR2GetCount,
      engineFamily: record.engineFamily,
    });
  } catch (error) {
    return jsonError("Web Play metadata failed", error);
  }
}
