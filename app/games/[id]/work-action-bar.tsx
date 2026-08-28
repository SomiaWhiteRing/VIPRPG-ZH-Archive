"use client";
import { buttonVariants } from "@/app/components/ui/button";

import Link from "next/link";
import { formatNumber, formatBytes } from "@/lib/format";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";

type Props = {
  workId: number;
  isAuthenticated: boolean;
  archive: {
    id: number;
    downloadHref: string;
    totalFiles: number;
    totalSizeBytes: number;
  } | null;
  canPlayInBrowser: boolean;
};

export function WorkActionBar({ archive, canPlayInBrowser, workId, isAuthenticated }: Props) {
  return (
    <section
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-sm"
      aria-label="主操作"
    >
      {archive ? (
        <>
          <span className="text-sm text-muted">
            {formatNumber(archive.totalFiles)} 文件 · {formatBytes(archive.totalSizeBytes)}
          </span>
          <Rm2kButton
            href={archive.downloadHref}
            onClick={() => {
              if (isAuthenticated) {
                void fetch(`/api/works/${workId}/played`, { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => undefined);
              }
            }}
          >
            下载游戏
          </Rm2kButton>
          {canPlayInBrowser ? (
            <Link className={buttonVariants({ variant: "outline" })} href={`/play/${archive.id}`}>
              ▶ 在线游玩
            </Link>
          ) : null}
        </>
      ) : (
        <span className="text-sm text-muted">该作品目前暂无可下载的当前快照。</span>
      )}
    </section>
  );
}
