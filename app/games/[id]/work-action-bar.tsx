"use client";
import { buttonVariants } from "@/app/components/ui/button";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import Link from "next/link";
import { Download, ExternalLink, Play } from "lucide-react";
import { formatBytes } from "@/lib/format";

type Props = {
  workId: number;
  isAuthenticated: boolean;
  archive: {
    id: number;
    downloadHref: string;
    totalFiles: number;
    totalSizeBytes: number;
  } | null;
  externalDownload: { url: string } | null;
};

export function WorkActionBar({
  archive,
  externalDownload,
  workId,
  isAuthenticated,
}: Props) {
  return (
    <div className="grid gap-3.5" aria-label="主操作">
      {archive ? (
        <>
          <div className="grid gap-2.5">
            <Rm2kButton
              className="min-h-12.5 w-full text-base"
              href={`/play/${archive.id}`}
              icon={<Play aria-hidden />}
            >
              在线游玩
            </Rm2kButton>
            <Link
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
              <span className="text-xs text-muted">{formatBytes(archive.totalSizeBytes)}</span>
            </Link>
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
        <span className="font-mono text-xs leading-[1.6] text-muted">该作品目前暂无可下载的当前快照。</span>
      )}
    </div>
  );
}
