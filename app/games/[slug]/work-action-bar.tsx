"use client";

import Link from "next/link";
import { useState } from "react";
import { formatNumber, formatBytes } from "@/lib/format";

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

export function WorkActionBar({
  archive,
  canPlayInBrowser,
}: Props) {
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
    <section className="work-action-bar" aria-label="主操作">
      {archive ? (
        <>
          <span className="work-action-meta">
            当前归档：<strong>{archive.label}</strong>
            <br />
            {formatNumber(archive.totalFiles)} 文件 · {formatBytes(archive.totalSizeBytes)}
          </span>
          <a className="button primary" href={archive.downloadHref}>
            ⬇ 下载 ZIP
          </a>
          {canPlayInBrowser ? (
            <Link className="button" href={`/play/${archive.id}`}>
              ▶ 在线游玩
            </Link>
          ) : (
            <span className="muted-line">
              该作品使用 Maniacs Patch，暂不支持在线游玩，请下载 ZIP。
            </span>
          )}
          <button className="button" type="button" onClick={copyId}>
            {copied ? "已复制 ✓" : `复制 ID #${archive.id}`}
          </button>
        </>
      ) : (
        <span className="work-action-meta">
          该作品暂无可下载的最新快照，可在版本列表中选择历史快照。
        </span>
      )}
    </section>
  );
}
