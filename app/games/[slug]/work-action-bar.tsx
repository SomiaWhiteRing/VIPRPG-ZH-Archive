"use client";
import { Button, buttonVariants } from "@/app/components/ui/button";

import Link from "next/link";
import { useState } from "react";
import { formatNumber, formatBytes } from "@/lib/format";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { publicCopy } from "@/lib/public-copy";

type Props = {
  archive: {
    id: number;
    label: string;
    downloadHref: string;
    totalFiles: number;
    totalSizeBytes: number;
  } | null;
  canPlayInBrowser: boolean;
};

export function WorkActionBar({ archive, canPlayInBrowser }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyId() {
    if (!archive) {
      return;
    }

    try {
      await navigator.clipboard.writeText(String(archive.id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <section
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-sm"
      aria-label="主操作"
    >
      {archive ? (
        <>
          <span className="text-sm text-muted">
            当前下载版本：<strong>{publicCopy(archive.label)}</strong>
            <br />
            {formatNumber(archive.totalFiles)} 文件 · {formatBytes(archive.totalSizeBytes)}
          </span>
          <Rm2kButton href={archive.downloadHref}>下载游戏</Rm2kButton>
          {canPlayInBrowser ? (
            <Link className={buttonVariants({ variant: "outline" })} href={`/play/${archive.id}`}>
              ▶ 在线游玩
            </Link>
          ) : (
            <span className="text-sm text-muted">该作品使用 Maniacs Patch，暂不支持在线游玩，请下载 ZIP。</span>
          )}
          <Button variant="outline" type="button" onClick={copyId}>
            {copied ? "已复制 ✓" : `复制 ID #${archive.id}`}
          </Button>
        </>
      ) : (
        <span className="text-sm text-muted">该作品目前暂无可下载的当前快照。</span>
      )}
    </section>
  );
}
