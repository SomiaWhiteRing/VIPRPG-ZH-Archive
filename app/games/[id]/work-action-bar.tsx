import { useMessages } from "@/lib/i18n/react";
import { useSyncExternalStore } from "react";
import { isAndroidClient } from "@/lib/browser/client-environment";
const subscribeEnvironment = () => () => {};
import { buttonVariants } from "@/app/components/ui/button";
import { LocalInstallButton } from "./local-install-button";
import { formatBytes } from "@/lib/format";
import { Download, ExternalLink } from "lucide-react";
import { KaiImportLink } from "./kai-import-link";
import { useArchiveDownload } from "@/app/components/use-archive-download";
import { reportWorkPlayed } from "@/lib/browser/work-play";
import { trackDownloadClick } from "@/lib/browser/site-analytics";

type Props = {
  restricted?: boolean;
  workId: number;
  title: string;
  coverBlobSha256: string | null;
  engineFamily: string;
  archive: {
    id: number;
    manifestSha256: string;
    totalFiles: number;
    totalSizeBytes: number;
    embeddedPlayerSizeBytes: number;
    downloadSizeBytes: number | null;
    webPlayFileCount: number;
    webPlaySizeBytes: number;
  } | null;
  externalDownload: { url: string } | null;
};

export function WorkActionBar({
  archive, title, coverBlobSha256,
  externalDownload,
  workId,
  engineFamily,
  restricted = false,
}: Props) {
  const native = useSyncExternalStore(subscribeEnvironment, isAndroidClient, () => false);
  const { downloadUrl, downloadSize } = useArchiveDownload();
  const sizeBytes = archive ? downloadSize(archive) : null;
  const reportDownload = () => {
    reportWorkPlayed(workId);
    trackDownloadClick(workId, archive?.id ?? null, sizeBytes, !archive);
  };
  const t = useMessages();
  return (
    <div className="grid gap-3.5" aria-label={t("work.sidebar.primary")}>
      {archive ? (
        <>
          <div className="grid gap-2.5">
            <LocalInstallButton id={archive.id} bytes={archive.webPlaySizeBytes} title={title} workId={workId} coverBlobSha256={coverBlobSha256} />
            {!native && <a
              className={`${buttonVariants({ variant: "outline" })} min-h-11 w-full`}
              href={downloadUrl(archive.id, archive.manifestSha256)}
              onClick={reportDownload}
              onAuxClick={(event) => { if (event.button === 1) reportDownload(); }}
            >
              <Download aria-hidden />
              {t("work.download.zip")}
              <span className="text-xs text-muted">
                {sizeBytes === null ? t("work.download.unavailable") : formatBytes(sizeBytes)}
              </span>
            </a>}
            {!restricted && ["rpg_maker_2000", "rpg_maker_2003", "rpg_maker_2003_maniac"].includes(engineFamily) &&
              archive.webPlaySizeBytes <= 1024 ** 3 && archive.webPlayFileCount <= 50000 ? (
                <KaiImportLink archiveVersionId={archive.id} />
              ) : null}
          </div>
        </>
      ) : externalDownload ? (
        <a
          aria-label={t("work.sidebar.externalDownload")}
          className={`${buttonVariants({ variant: "rm2k" })} min-h-12.5 w-full text-base`}
          href={externalDownload.url}
          onClick={reportDownload}
          onAuxClick={(event) => { if (event.button === 1) reportDownload(); }}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" size={16} />
          {t("work.download.external")}
        </a>
      ) : (
        <span className="font-mono text-xs leading-[1.6] text-muted">
          {t("work.sidebar.noDownload")}
        </span>
      )}
    </div>
  );
}
