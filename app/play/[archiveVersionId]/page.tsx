import { buttonVariants } from "@/app/components/ui/button";
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
  getWebPlayInstallTargetTotals,
  parseArchiveVersionId,
} from "@/lib/server/db/archive-downloads";
import { WebPlayClient } from "@/app/play/[archiveVersionId]/web-play-client";
import type { WebPlayMetadata } from "@/app/play/[archiveVersionId]/web-play-types";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { publicCopy } from "@/lib/public-copy";

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

  const installTarget = await getWebPlayInstallTargetTotals(record.id);

  const metadata: WebPlayMetadata = {
    ok: true,
    archiveVersionId: record.id,
    workId: record.workId,
    title: record.workChineseTitle || record.workOriginalTitle,
    originalTitle: record.workOriginalTitle,
    chineseTitle: record.workChineseTitle,
    archiveLabel: record.archiveLabel,
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
    installTotalFiles: installTarget.totalFiles,
    installTotalSizeBytes: installTarget.totalSizeBytes,
    estimatedR2GetCount: record.estimatedR2GetCount,
    engineFamily: record.engineFamily,
    usesManiacsPatch: record.usesManiacsPatch,
    canPlay: !record.usesManiacsPatch,
  };

  return (
    <main>
      <PageHeader
        actions={
          <>
            <BackLink href="/" label="返回首页" />
            <a
              className={buttonVariants({ variant: "outline" })}
              href={`/api/archive-versions/${record.id}/download?zip_builder=${downloadZipBuilderVersion}`}
            >
              下载 ZIP
            </a>
          </>
        }
        subtitle={
          <>
            {publicCopy(metadata.archiveLabel)}
            {metadata.chineseTitle ? ` / ${metadata.originalTitle}` : ""}
          </>
        }
        title={metadata.title}
      />

      <WebPlayClient metadata={metadata} />
    </main>
  );
}
