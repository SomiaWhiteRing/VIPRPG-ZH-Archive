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

type Props = {
  workId: number;
  title: string;
  coverBlobSha256: string | null;
  engineFamily: string;
  archive: {
    id: number;
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
}: Props) {
  const native = useSyncExternalStore(subscribeEnvironment, isAndroidClient, () => false);
  const { downloadUrl, downloadSize } = useArchiveDownload();
  const sizeBytes = archive ? downloadSize(archive) : null;
  return (
    <div className="grid gap-3.5" aria-label="主操作">
      {archive ? (
        <>
          <div className="grid gap-2.5">
            <LocalInstallButton id={archive.id} bytes={archive.webPlaySizeBytes} title={title} workId={workId} coverBlobSha256={coverBlobSha256} />
            {!native && <a
              className={`${buttonVariants({ variant: "outline" })} min-h-11 w-full`}
              href={downloadUrl(archive.id)}
              onClick={() => reportWorkPlayed(workId)}
              onAuxClick={(event) => { if (event.button === 1) reportWorkPlayed(workId); }}
            >
              <Download aria-hidden />
              下载 ZIP
              <span className="text-xs text-muted">
                {sizeBytes === null ? "共享播放器暂不可用" : formatBytes(sizeBytes)}
              </span>
            </a>}
            {["rpg_maker_2000", "rpg_maker_2003", "rpg_maker_2003_maniac"].includes(engineFamily) &&
              archive.webPlaySizeBytes <= 1024 ** 3 && archive.webPlayFileCount <= 50000 ? (
                <KaiImportLink archiveVersionId={archive.id} />
              ) : null}
          </div>
        </>
      ) : externalDownload ? (
        <a
          aria-label="外部下载：前往下载页"
          className={`${buttonVariants({ variant: "rm2k" })} min-h-12.5 w-full text-base`}
          href={externalDownload.url}
          onClick={() => reportWorkPlayed(workId)}
          onAuxClick={(event) => { if (event.button === 1) reportWorkPlayed(workId); }}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" size={16} />
          前往下载页
        </a>
      ) : (
        <span className="font-mono text-xs leading-[1.6] text-muted">
          该作品目前暂无可用的下载来源。
        </span>
      )}
    </div>
  );
}
