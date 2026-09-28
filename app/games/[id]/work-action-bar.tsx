import { useSyncExternalStore } from "react";
import { isAndroidClient } from "@/lib/browser/client-environment";
const subscribeEnvironment = () => () => {};
import { buttonVariants } from "@/app/components/ui/button";
import { LocalInstallButton } from "./local-install-button";
import { formatBytes } from "@/lib/format";
import { Download, ExternalLink } from "lucide-react";
import { KaiImportLink } from "./kai-import-link";

type Props = {
  workId: number;
  title: string;
  coverBlobSha256: string | null;
  isAuthenticated: boolean;
  engineFamily: string;
  archive: {
    id: number;
    downloadHref: string;
    totalFiles: number;
    totalSizeBytes: number;
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
  isAuthenticated,
  engineFamily,
}: Props) {
  const native = useSyncExternalStore(subscribeEnvironment, isAndroidClient, () => false);
  return (
    <div className="grid gap-3.5" aria-label="主操作">
      {archive ? (
        <>
          <div className="grid gap-2.5">
            <LocalInstallButton id={archive.id} bytes={archive.webPlaySizeBytes} title={title} workId={workId} coverBlobSha256={coverBlobSha256} />
            {!native && <a
              className={`${buttonVariants({ variant: "outline" })} min-h-11 w-full`}
              href={archive.downloadHref}
              onClick={() => {
                if (isAuthenticated) {
                  void fetch(`/api/works/${workId}/played`, {
                    method: "POST",
                    credentials: "same-origin",
                    keepalive: true,
                  }).catch(() => undefined);
                }
              }}
            >
              <Download aria-hidden />
              下载 ZIP
              <span className="text-xs text-muted">
                {archive.downloadSizeBytes === null ? "共享播放器暂不可用" : formatBytes(archive.downloadSizeBytes)}
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
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" size={16} />
          前往下载页
        </a>
      ) : (
        <span className="font-mono text-xs leading-[1.6] text-muted">
          该作品目前暂无可下载的当前快照。
        </span>
      )}
    </div>
  );
}
