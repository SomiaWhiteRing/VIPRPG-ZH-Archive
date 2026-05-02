import { downloadZipBuilderVersion } from "@/lib/archive/download";
import {
  buildArchiveDownloadUrl,
  buildWebPlayKey,
  easyRpgRuntimeBasePath,
  easyRpgRuntimeVersion,
  webPlayInstallerVersion,
} from "@/lib/archive/web-play";
import {
  getPublishedArchiveDownloadRecord,
  parseArchiveVersionId,
} from "@/lib/server/db/archive-downloads";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    archiveVersionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { archiveVersionId: rawArchiveVersionId } = await context.params;
    const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
    const record = await getPublishedArchiveDownloadRecord(archiveVersionId);

    if (!record) {
      return json(
        {
          ok: false,
          error: "Archive version not found",
        },
        { status: 404 },
      );
    }

    const playKey = buildWebPlayKey({
      archiveVersionId: record.id,
      manifestSha256: record.manifestSha256,
    });

    return json({
      ok: true,
      archiveVersionId: record.id,
      releaseId: record.releaseId,
      workId: record.workId,
      title: record.workChineseTitle || record.workOriginalTitle,
      originalTitle: record.workOriginalTitle,
      chineseTitle: record.workChineseTitle,
      workSlug: record.workSlug,
      releaseLabel: record.releaseLabel,
      archiveLabel: record.archiveLabel,
      archiveKey: record.archiveKey,
      manifestSha256: record.manifestSha256,
      downloadZipBuilderVersion,
      webPlayInstallerVersion,
      easyRpgRuntimeVersion,
      runtimeBasePath: easyRpgRuntimeBasePath,
      playKey,
      downloadUrl: buildArchiveDownloadUrl(record.id),
      totalFiles: record.totalFiles,
      totalSizeBytes: record.totalSizeBytes,
      estimatedR2GetCount: record.estimatedR2GetCount,
      engineFamily: record.engineFamily,
      usesManiacsPatch: record.usesManiacsPatch,
      canPlay: !record.usesManiacsPatch,
    });
  } catch (error) {
    return jsonError("Web Play metadata failed", error);
  }
}
