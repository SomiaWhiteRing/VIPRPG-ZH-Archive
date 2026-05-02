import Link from "next/link";
import { notFound } from "next/navigation";
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
import { WebPlayClient } from "@/app/play/[archiveVersionId]/web-play-client";
import type { WebPlayMetadata } from "@/app/play/[archiveVersionId]/web-play-types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    archiveVersionId: string;
  }>;
};

export default async function WebPlayPage({ params }: PageProps) {
  const { archiveVersionId: rawArchiveVersionId } = await params;
  let archiveVersionId: number;

  try {
    archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
  } catch {
    notFound();
  }

  const record = await getPublishedArchiveDownloadRecord(archiveVersionId);

  if (!record) {
    notFound();
  }

  const metadata: WebPlayMetadata = {
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
    playKey: buildWebPlayKey({
      archiveVersionId: record.id,
      manifestSha256: record.manifestSha256,
    }),
    downloadUrl: buildArchiveDownloadUrl(record.id),
    totalFiles: record.totalFiles,
    totalSizeBytes: record.totalSizeBytes,
    estimatedR2GetCount: record.estimatedR2GetCount,
    engineFamily: record.engineFamily,
    usesManiacsPatch: record.usesManiacsPatch,
    canPlay: !record.usesManiacsPatch,
  };

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Online Play</p>
          <h1>{metadata.title}</h1>
          <p className="subtitle">
            {metadata.releaseLabel} / {metadata.archiveLabel}
            {metadata.chineseTitle ? ` / ${metadata.originalTitle}` : ""}
          </p>
        </div>
        <div className="header-actions">
          <Link className="button" href="/">
            返回首页
          </Link>
          <a
            className="button"
            href={`/api/archive-versions/${record.id}/download?zip_builder=${downloadZipBuilderVersion}`}
          >
            下载 ZIP
          </a>
        </div>
      </header>

      <WebPlayClient metadata={metadata} />
    </main>
  );
}
