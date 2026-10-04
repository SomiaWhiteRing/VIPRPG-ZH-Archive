import { InfoRow } from "@/app/components/ui/info-row";
import { Button } from "@/app/components/ui/button";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import type {
  GameArchiveVersionDetail,
  GameWorkDetail,
} from "@/lib/dto/db/game-library";
import { formatBytes, formatNumber } from "@/lib/format";
import { creatorRoleLabel, engineLabel, languageLabel } from "@/lib/labels";
import { ChevronRight } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useArchiveDownload } from "@/app/components/use-archive-download";

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
    | "genre"
    | "referenceDuration"
    | "moreInfo"
    | "maintainers"
    | "originalReleaseDate"
    | "originalReleasePrecision"
    | "downloadSizeBytes"
  >;
}) {
  const [filesExpanded, setFilesExpanded] = useState(false);
  const { downloadSize, includePlayer } = useArchiveDownload();
  const sizeBytes = current ? downloadSize({ ...current, downloadSizeBytes: work.downloadSizeBytes }) : null;
  const filesId = useId();
  const filesToggled = useRef(false);
  const people = current?.uploaderName ? [{
    id: current.uploaderId,
    displayName: current.uploaderName,
    avatarBlobSha256: current.uploaderAvatarBlobSha256,
  }] : work.maintainers;
  const peopleInfo = people.length ? (
    <InfoRow label={current?.uploaderName ? "上传者" : "维护者"}>
      <span className="inline-flex max-w-full flex-wrap gap-x-3 gap-y-1">
        {people.map((person) => person.id ? (
          <span className="inline-flex max-w-full items-center gap-1.5" key={person.id}>
            <Link
              aria-label={`${person.displayName}的个人主页`}
              className="shrink-0 rounded-full"
              to={`/users/${person.id}`}
            >
              <UserAvatar
                avatarBlobSha256={person.avatarBlobSha256}
                className="size-[1em]"
                displayName={person.displayName}
                size={14}
              />
            </Link>
            <Link
              className="min-w-0 font-medium text-secondary hover:underline"
              to={`/games?uploader=${person.id}`}
            >
              {person.displayName}
            </Link>
          </span>
        ) : <span key={person.displayName}>{person.displayName}</span>)}
      </span>
    </InfoRow>
  ) : null;

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
        {work.genre ? <InfoRow label="类型"><Link className="font-medium text-secondary hover:underline" to={`/games?${new URLSearchParams({ genre: work.genre })}`}>{work.genre}</Link></InfoRow> : null}
        {work.referenceDuration ? <InfoRow label="参考时长">{work.referenceDuration}</InfoRow> : null}
        <InfoRow label="引擎">{engineLabel(work.engineFamily)}</InfoRow>
        <InfoRow label="语言">{languageLabel(work.language)}</InfoRow>
        {work.originalReleaseDate && work.originalReleasePrecision !== "unknown" ? (
          <InfoRow label="发布日期" mono>
            {work.originalReleaseDate}
          </InfoRow>
        ) : null}
        {current?.sourceUrl ? (
          <InfoRow label="发布地址">
            <a
              className="font-medium text-secondary hover:underline"
              href={current.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {current.sourceUrl}
            </a>
          </InfoRow>
        ) : null}
      </dl>

      <p className="my-[0.65rem] mb-[0.35rem] font-mono text-xs tracking-[0.08em] text-muted">
        制作名单
      </p>
      <dl className="m-0">
        {!work.creators.some((creator) => creator.roleKey === "author") ? (
          <InfoRow label="作者">VIPPER</InfoRow>
        ) : null}
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
                  {formatNumber(current.totalFiles + (includePlayer && current.usesSharedPlayer && sizeBytes !== null ? 1 : 0) - (!includePlayer && current.embeddedPlayerSizeBytes > 0 ? 1 : 0))} 个
                </InfoRow>
                <InfoRow label="体积" mono>
                  {sizeBytes === null ? "共享播放器暂不可用" : formatBytes(sizeBytes)}
                </InfoRow>
                {peopleInfo}
                {current.publishedAt ? (
                  <InfoRow label="收录" mono>
                    {current.publishedAt.slice(0, 10)}
                  </InfoRow>
                ) : null}
              </dl>
            </div>
          </div>
        </div>
      ) : peopleInfo ? <dl className="m-0 mt-[0.65rem]">{peopleInfo}</dl> : null}
    </div>
  );
}
