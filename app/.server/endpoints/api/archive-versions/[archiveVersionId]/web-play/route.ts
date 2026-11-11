import {
  getArchiveNetplayEndpoint,
  getPublishedArchiveDownloadRecord,
  parseArchiveVersionId,
} from "@/app/.server/db/archive-downloads";
import type { AppRuntime } from "@/app/.server/runtime";
import { readArchiveEasyRpgConfig } from "@/app/.server/storage/archive-bucket";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import {
  buildWebPlayDownloadUrl,
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
  request: Request,
  context: RouteContext,
) {
  try {
    const { archiveVersionId: rawArchiveVersionId } = await context.params;
    const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
    const options = new URL(request.url).searchParams;
    const endpointOnly = options.get("fields") === "netplayEndpoint";
    const record = await getPublishedArchiveDownloadRecord(
      runtime,
      archiveVersionId,
      endpointOnly,
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

    if (endpointOnly) {
      return json({ ok: true, netplayEndpoint: await getArchiveNetplayEndpoint(runtime, record, options.get("netplayExternal") === "1") });
    }

    const easyRpg = await readArchiveEasyRpgConfig(runtime, record.manifestSha256);
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
      downloadUrl: buildWebPlayDownloadUrl(record.id),
      totalFiles: record.totalFiles,
      totalSizeBytes: record.totalSizeBytes,
      installTotalFiles: record.installTotalFiles,
      installTotalSizeBytes: record.installTotalSizeBytes,
      estimatedR2GetCount: record.estimatedR2GetCount,
      engineFamily: record.engineFamily,
      easyRpg,
      netplayEndpoint: easyRpg?.netplay ? await getArchiveNetplayEndpoint(runtime, record) : undefined,
    });
  } catch (error) {
    return jsonError("Web Play metadata failed", error);
  }
}
