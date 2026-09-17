import { getCurrentUser } from "@/app/.server/auth/current-user";
import {
  getPublishedArchiveDownloadRecord,
  getWebPlayInstallTargetTotals,
  parseArchiveVersionId,
} from "@/app/.server/db/archive-downloads";
import { getGameWorkDetail } from "@/app/.server/db/game-library";
import {
  getWorkCommunitySummary,
  listPickerEmojis,
  listRootComments,
} from "@/app/.server/db/work-community";
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { CommentPanel } from "@/app/components/comments/comment-panel";
import { DetailPageShell } from "@/app/components/ui/detail-page-layout";
import { WorkCommunityStats } from "@/app/components/work/work-community-stats";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import {
  WorkPageHeader,
  WorkPageNotice,
} from "@/app/components/work/work-page-header";
import { WorkSidebarInfo } from "@/app/components/work/work-sidebar-info";
import { WorkViewTracker } from "@/app/components/work/work-view-tracker";
import { WebPlayClient } from "@/app/play/[archiveVersionId]/web-play-client";
import type { WebPlayMetadata } from "@/app/play/[archiveVersionId]/web-play-types";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import {
  buildArchiveDownloadUrl,
  buildWebPlayKey,
  easyRpgRuntimeBasePath,
  easyRpgRuntimeVersion,
  webPlayInstallerVersion,
} from "@/lib/archive/web-play";
import { AlertTriangle } from "lucide-react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const { archiveVersionId: rawArchiveVersionId } = await params;
  let archiveVersionId: number;

  try {
    archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
  } catch {
    throwNotFound();
  }

  const record = await getPublishedArchiveDownloadRecord(
    runtime,
    archiveVersionId,
  );

  if (!record) {
    throwNotFound();
  }

  const [installTarget, currentUser, work] = await Promise.all([
    getWebPlayInstallTargetTotals(runtime, record.id),
    getCurrentUser(runtime),
    getGameWorkDetail(runtime, record.workId),
  ]);

  if (!work) {
    throwNotFound();
  }

  const [community, comments, emojis] = await Promise.all([
    getWorkCommunitySummary(runtime, work.id, currentUser?.id ?? null),
    listRootComments(
      runtime,
      { kind: "work", id: work.id },
      currentUser?.id ?? null,
      null,
    ),
    listPickerEmojis(runtime),
  ]);
  const current =
    work.archiveVersions.find((archive) => archive.id === record.id) ?? null;

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

  return {
    record,
    currentUser: pickPageFields(currentUser, ["id"]),
    work,
    community,
    comments,
    emojis,
    current,
    metadata,
  };
}

export default function WebPlayPage() {
  const {
    record,
    currentUser,
    work,
    community,
    comments,
    emojis,
    current,
    metadata,
  } = useLoaderData<typeof loader>();
  return (
    <DetailPageShell
      key={`${metadata.playKey}:${currentUser?.id ?? "anonymous"}`}
    >
      <WorkViewTracker workId={work.id} />
      <WorkPageHeader
        chineseTitle={work.chineseTitle}
        engineFamily={work.engineFamily}
        language={work.language}
        originalTitle={work.originalTitle}
        tabs={[
          { href: `/games/${work.id}`, label: "详情" },
          { href: `/play/${record.id}`, label: "在线游玩", active: true },
          {
            href: "#sec-comments",
            label: "评论",
            count: community.commentCount,
          },
        ]}
      />
      <WebPlayClient
        comments={
          <CommentPanel
            currentUserId={currentUser?.id ?? null}
            emojis={emojis}
            initialComments={comments.items}
            initialNextCursor={comments.nextCursor}
            target={{ kind: "work", id: work.id }}
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
        notice={
          metadata.engineFamily === "rpg_maker_2003_maniac" ? (
            <WorkPageNotice>
              <AlertTriangle
                aria-hidden
                className="mt-0.5 shrink-0"
                size={16}
              />
              <span>该游戏使用了 Maniac，可能无法用 EasyRPG 正常游玩。</span>
            </WorkPageNotice>
          ) : null
        }
        secondary={<WorkSidebarInfo current={current} work={work} />}
        stats={
          <WorkCommunityStats
            commentCount={community.commentCount}
            playerCount={community.playerCount}
            viewCount={community.viewCount}
          />
        }
      />
    </DetailPageShell>
  );
}
