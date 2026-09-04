import { AlertTriangle } from "lucide-react";
import { notFound } from "next/navigation";
import { WorkCommunityStats } from "@/app/components/work/work-community-stats";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import { WorkPageHeader, WorkPageNotice } from "@/app/components/work/work-page-header";
import { WorkPageShell } from "@/app/components/work/work-page-layout";
import { WorkSidebarInfo } from "@/app/components/work/work-sidebar-info";
import { WorkViewTracker } from "@/app/components/work/work-view-tracker";
import { WorkCommunityPanel } from "@/app/games/[id]/work-community-panel";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import {
  buildArchiveDownloadUrl,
  buildWebPlayKey,
  easyRpgRuntimeBasePath,
  easyRpgRuntimeVersion,
  webPlayInstallerVersion,
} from "@/lib/archive/web-play";
import {
  getPublishedArchiveDownloadRecord,
  getWebPlayInstallTargetTotals,
  parseArchiveVersionId,
} from "@/lib/server/db/archive-downloads";
import { WebPlayClient } from "@/app/play/[archiveVersionId]/web-play-client";
import type { WebPlayMetadata } from "@/app/play/[archiveVersionId]/web-play-types";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { getGameWorkDetail } from "@/lib/server/db/game-library";
import {
  getWorkCommunitySummary,
  listPickerEmojis,
  listRootComments,
} from "@/lib/server/db/work-community";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    archiveVersionId: string;
  }>;
};

export default async function WebPlayPage({ params }: PageProps) {
  const { archiveVersionId: rawArchiveVersionId } = await params;
  let archiveVersionId: number;

  try {
    archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
  } catch {
    notFound();
  }

  const record = await getPublishedArchiveDownloadRecord(archiveVersionId);

  if (!record) {
    notFound();
  }

  const [installTarget, currentUser, work] = await Promise.all([
    getWebPlayInstallTargetTotals(record.id),
    getCurrentUserFromCookies(),
    getGameWorkDetail(record.workId),
  ]);

  if (!work) {
    notFound();
  }

  const [community, comments, emojis] = await Promise.all([
    getWorkCommunitySummary(work.id, currentUser?.id ?? null),
    listRootComments(work.id, currentUser?.id ?? null, null),
    listPickerEmojis(),
  ]);
  const current = work.archiveVersions.find((archive) => archive.id === record.id) ?? null;

  const metadata: WebPlayMetadata = {
    ok: true,
    archiveVersionId: record.id,
    workId: record.workId,
    title: record.workChineseTitle || record.workOriginalTitle,
    originalTitle: record.workOriginalTitle,
    chineseTitle: record.workChineseTitle,
    manifestSha256: record.manifestSha256,
    downloadZipBuilderVersion,
    webPlayInstallerVersion,
    easyRpgRuntimeVersion,
    runtimeBasePath: easyRpgRuntimeBasePath,
    playKey: buildWebPlayKey({
      archiveVersionId: record.id,
      manifestSha256: record.manifestSha256,
    }),
    downloadUrl: buildArchiveDownloadUrl(record.id),
    totalFiles: record.totalFiles,
    totalSizeBytes: record.totalSizeBytes,
    installTotalFiles: installTarget.totalFiles,
    installTotalSizeBytes: installTarget.totalSizeBytes,
    estimatedR2GetCount: record.estimatedR2GetCount,
    engineFamily: record.engineFamily,
  };

  return (
    <WorkPageShell>
      <WorkViewTracker workId={work.id} />
      <WorkPageHeader
        aliases={work.aliases}
        chineseTitle={work.chineseTitle}
        engineFamily={work.engineFamily}
        language={work.language}
        originalTitle={work.originalTitle}
        tabs={[
          { href: `/games/${work.id}`, label: "详情" },
          { href: `/play/${record.id}`, label: "在线游玩", active: true },
          { href: "#sec-comments", label: "评论", count: community.commentCount },
        ]}
      />
      <WebPlayClient
        comments={
          <WorkCommunityPanel
            currentUserId={currentUser?.id ?? null}
            emojis={emojis}
            initialComments={comments.items}
            initialNextCursor={comments.nextCursor}
            workId={work.id}
          />
        }
        engagement={
          <WorkFavoriteButton
            currentUserId={currentUser?.id ?? null}
            initialFavorited={community.favoritedByMe}
            workId={work.id}
          />
        }
        isAuthenticated={Boolean(currentUser)}
        metadata={metadata}
        notice={metadata.engineFamily === "rpg_maker_2003_maniac" ? (
          <WorkPageNotice>
            <AlertTriangle aria-hidden className="mt-0.5 shrink-0" size={16} />
            <span>该游戏使用了 Maniac，可能无法用 EasyRPG 正常游玩。</span>
          </WorkPageNotice>
        ) : null}
        secondary={<WorkSidebarInfo current={current} work={work} />}
        stats={
          <WorkCommunityStats
            commentCount={community.commentCount}
            playerCount={community.playerCount}
            viewCount={community.viewCount}
          />
        }
      />
    </WorkPageShell>
  );
}
