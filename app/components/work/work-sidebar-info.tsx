import { InfoRow } from "@/app/components/ui/info-row";
import type {
  GameArchiveVersionDetail,
  GameWorkDetail,
} from "@/lib/dto/db/game-library";
import { formatBytes, formatNumber } from "@/lib/format";
import { creatorRoleLabel, engineLabel, languageLabel } from "@/lib/labels";
import { Link } from "react-router";

export function WorkSidebarInfo({
  current,
  work,
}: {
  current: GameArchiveVersionDetail | null;
  work: Pick<
    GameWorkDetail,
    | "aliases"
    | "creators"
    | "engineFamily"
    | "language"
    | "moreInfo"
    | "originalReleaseDate"
    | "originalReleasePrecision"
  >;
}) {
  return (
    <div>
      <dl className="m-0">
        {work.aliases.length ? (
          <InfoRow label="别名">{work.aliases.join(" · ")}</InfoRow>
        ) : null}
        <InfoRow label="引擎">{engineLabel(work.engineFamily)}</InfoRow>
        <InfoRow label="语言">{languageLabel(work.language)}</InfoRow>
        <InfoRow label="发布日期" mono>
          {formatDateish(
            work.originalReleaseDate,
            work.originalReleasePrecision,
          )}
        </InfoRow>
      </dl>

      {work.creators.length || work.moreInfo.length ? (
        <>
          <p className="my-[0.65rem] mb-[0.35rem] font-mono text-xs tracking-[0.08em] text-muted">
            制作名单
          </p>
          <dl className="m-0">
            {work.creators.map((creator) => (
              <InfoRow
                key={`${creator.id}-${creator.roleKey}`}
                label={creator.roleLabel || creatorRoleLabel(creator.roleKey)}
              >
                <Link
                  className="font-medium text-[#1f6f67] hover:underline"
                  to={`/creators/${creator.id}`}
                >
                  {creator.displayName}
                </Link>
              </InfoRow>
            ))}
            {work.moreInfo.map((item, index) => (
              <InfoRow key={`more-info-${index}`} label={item.title}>
                <span className="whitespace-pre-wrap">{item.body}</span>
              </InfoRow>
            ))}
          </dl>
        </>
      ) : null}

      {current ? (
        <details className="mt-[0.65rem]">
          <summary className="cursor-pointer py-1 font-mono text-xs tracking-[0.08em] text-muted hover:text-foreground">
            文件信息
          </summary>
          <dl className="m-0 mt-[0.35rem]">
            <InfoRow label="文件" mono>
              {formatNumber(current.totalFiles)} 个
            </InfoRow>
            <InfoRow label="体积" mono>
              {formatBytes(current.totalSizeBytes)}
            </InfoRow>
            {current.uploaderName ? (
              <InfoRow label="上传者">
                {current.uploaderId ? (
                  <Link
                    className="font-medium text-[#1f6f67] hover:underline"
                    to={`/games?uploader=${current.uploaderId}`}
                  >
                    {current.uploaderName}
                  </Link>
                ) : current.uploaderName}
              </InfoRow>
            ) : null}
            {current.publishedAt ? (
              <InfoRow label="收录" mono>
                {current.publishedAt.slice(0, 10)}
              </InfoRow>
            ) : null}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function formatDateish(value: string | null, precision: string): string {
  return !value || precision === "unknown" ? "日期未知" : value;
}
