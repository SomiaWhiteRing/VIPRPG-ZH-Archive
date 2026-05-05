"use client";

import Link from "next/link";
import { useState } from "react";

type Props = {
  archiveId: number;
  archiveLabel: string;
  downloadHref: string;
  totalFiles: number;
  totalSizeBytes: number;
  canPlayInBrowser: boolean;
};

export function WorkActionBar({
  archiveId,
  archiveLabel,
  downloadHref,
  totalFiles,
  totalSizeBytes,
  canPlayInBrowser,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(String(archiveId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <section className="work-action-bar" aria-label="主操作">
      <span className="work-action-meta">
        当前归档：<strong>{archiveLabel}</strong>
        <br />
        {formatNumber(totalFiles)} 文件 · {formatBytes(totalSizeBytes)}
      </span>
      <a className="button primary" href={downloadHref}>
        ⬇ 下载 ZIP
      </a>
      {canPlayInBrowser ? (
        <Link className="button" href={`/play/${archiveId}`}>
          ▶ 在线游玩
        </Link>
      ) : null}
      <button className="button" type="button" onClick={copyId}>
        {copied ? "已复制 ✓" : `复制 ID #${archiveId}`}
      </button>
    </section>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
