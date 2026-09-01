import type { ReactNode } from "react";
import Link from "next/link";
import { formatBytes, formatNumber } from "@/lib/format";
import { creatorRoleLabel, engineLabel, languageLabel } from "@/lib/labels";
import type { GameArchiveVersionDetail, GameWorkDetail } from "@/lib/server/db/game-library";

export function WorkSidebarInfo({
  current,
  work,
}: {
  current: GameArchiveVersionDetail | null;
  work: Pick<
    GameWorkDetail,
    | "creators"
    | "distribution"
    | "engineFamily"
    | "isOriginal"
    | "language"
    | "originalReleaseDate"
    | "originalReleasePrecision"
  >;
}) {
  return (
    <div>
      <dl className="m-0">
        <InfoRow label="引擎">{engineLabel(work.engineFamily)}</InfoRow>
        <InfoRow label="语言">{languageLabel(work.language)}</InfoRow>
        <InfoRow label="首发" mono>{formatDateish(work.originalReleaseDate, work.originalReleasePrecision)}</InfoRow>
        <InfoRow label="类型">{work.isOriginal ? "本站原创" : "社区收录"}</InfoRow>
        <InfoRow label="分发">
          <span className={`inline-flex min-h-[1.6rem] items-center rounded-full border bg-card px-[0.6rem] py-[0.15rem] font-mono text-xs tracking-[0.04em] ${work.distribution === "external" ? "border-accent/45 text-[#a7471e]" : "border-primary/40 text-[#1f6f67]"}`}>
            {distributionLabel(work.distribution)}
          </span>
        </InfoRow>
      </dl>

      {current ? (
        <>
          <p className="my-[0.65rem] mb-[0.35rem] font-mono text-xs tracking-[0.08em] text-muted">当前快照</p>
          <dl className="m-0">
            <InfoRow label="文件" mono>{formatNumber(current.totalFiles)} 个</InfoRow>
            <InfoRow label="体积" mono>{formatBytes(current.totalSizeBytes)}</InfoRow>
            {current.uploaderName ? <InfoRow label="上传">{current.uploaderName}</InfoRow> : null}
            {current.publishedAt ? <InfoRow label="收录" mono>{current.publishedAt.slice(0, 10)}</InfoRow> : null}
          </dl>
        </>
      ) : null}

      <p className="my-[0.65rem] mb-[0.35rem] font-mono text-xs tracking-[0.08em] text-muted">制作名单</p>
      <dl className="m-0">
        {work.creators.length ? work.creators.map((creator) => (
          <InfoRow key={`${creator.id}-${creator.roleKey}`} label={creator.roleLabel || creatorRoleLabel(creator.roleKey)}>
            <Link className="font-medium text-[#1f6f67] hover:underline" href={`/creators/${creator.id}`}>{creator.name}</Link>
          </InfoRow>
        )) : <InfoRow label="记录">暂无</InfoRow>}
      </dl>
    </div>
  );
}

function InfoRow({
  children,
  label,
  mono = false,
}: {
  children: ReactNode;
  label: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-dashed border-border py-1.75 text-sm last:border-b-0">
      <dt className="w-17 shrink-0 text-xs text-muted">{label}</dt>
      <dd className={`m-0 min-w-0 wrap-anywhere ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function distributionLabel(value: string): string {
  return value === "archive" ? "本站归档" : value === "external" ? "外部发布" : "来源待整理";
}

function formatDateish(value: string | null, precision: string): string {
  return !value || precision === "unknown" ? "日期未知" : value;
}
