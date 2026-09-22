import { InfoRow } from "@/app/components/ui/info-row";
import { Button } from "@/app/components/ui/button";
import type {
  GameArchiveVersionDetail,
  GameWorkDetail,
} from "@/lib/dto/db/game-library";
import { formatBytes, formatNumber } from "@/lib/format";
import { creatorRoleLabel, engineLabel, languageLabel } from "@/lib/labels";
import { ChevronRight } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
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
  const [filesExpanded, setFilesExpanded] = useState(false);
  const filesId = useId();
  const filesToggled = useRef(false);

  useLayoutEffect(() => {
    if (!filesToggled.current) return;

    // Keep the viewport steady while the disclosure changes the page height.
    const style = document.documentElement.style;
    const previous = style.getPropertyValue("overflow-anchor");
    const priority = style.getPropertyPriority("overflow-anchor");
    style.setProperty("overflow-anchor", "none");
    const restore = () => {
      if (previous) style.setProperty("overflow-anchor", previous, priority);
      else style.removeProperty("overflow-anchor");
    };
    const timer = window.setTimeout(restore, 350);
    return () => {
      window.clearTimeout(timer);
      restore();
    };
  }, [filesExpanded]);

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
                  className="font-medium text-secondary hover:underline"
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
        <div className="mt-[0.65rem]">
          <Button
            variant="ghost"
            aria-controls={filesId}
            aria-expanded={filesExpanded}
            className="min-h-0 gap-1 rounded-none px-0 py-1 font-mono text-xs font-normal tracking-[0.08em] text-muted hover:bg-transparent hover:text-foreground [&_svg]:size-3"
            onClick={() => {
              filesToggled.current = true;
              setFilesExpanded((expanded) => !expanded);
            }}
            type="button"
          >
            <ChevronRight
              aria-hidden
              className={`shrink-0 transition-transform duration-300 ease-in-out motion-reduce:transition-none ${filesExpanded ? "rotate-90" : ""}`}
              size={12}
            />
            文件信息
          </Button>
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none ${filesExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            id={filesId}
            inert={!filesExpanded}
            aria-hidden={!filesExpanded}
          >
            <div className="min-h-0 overflow-hidden">
              <dl className="m-0 pt-[0.35rem]">
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
                        className="font-medium text-secondary hover:underline"
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
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatDateish(value: string | null, precision: string): string {
  return !value || precision === "unknown" ? "日期未知" : value;
}
