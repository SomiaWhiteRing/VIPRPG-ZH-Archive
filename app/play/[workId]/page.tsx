import { getCurrentUser } from "@/app/.server/auth/current-user";
import {
  getPublishedArchiveDownloadRecord,
} from "@/app/.server/db/archive-downloads";
import { getGameWorkDetail } from "@/app/.server/db/game-library";
import {
  getWorkCommunitySummary,
  listRootComments,
} from "@/app/.server/db/work-community";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { CommentPanel } from "@/app/components/comments/comment-panel";
import { DetailPageShell } from "@/app/components/ui/detail-page-layout";
import { WorkCommunityStats } from "@/app/components/work/work-community-stats";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import { useWorkFavorite } from "@/app/components/work/use-work-favorite";
import {
  WorkPageHeader,
  WorkPageNotice,
} from "@/app/components/work/work-page-header";
import { WorkSidebarInfo } from "@/app/components/work/work-sidebar-info";
import { WorkViewTracker } from "@/app/components/work/work-view-tracker";
import { WebPlayClient } from "@/app/play/[workId]/web-play-client";
import type { WebPlayMetadata } from "@/app/play/[workId]/web-play-types";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import {
  buildWebPlayDownloadUrl,
  buildWebPlayKey,
  easyRpgRuntimeBasePath,
  easyRpgRuntimeVersion,
  webPlayInstallerVersion,
} from "@/lib/archive/web-play";
import { AlertTriangle } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useSyncExternalStore } from "react";
import { isAndroidClient } from "@/lib/browser/client-environment";
import { LocalInstallButton } from "@/app/games/[id]/local-install-button";

const subscribeEnvironment = () => () => {};

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const { workId: rawWorkId } = await params;
  let workId: number;

  try {
    workId = parsePositiveId(rawWorkId, "work id");
  } catch {
    throwNotFound();
  }

  const work = await getGameWorkDetail(runtime, workId);
  if (!work) throwNotFound();

  const current = work.archiveVersions.find((archive) => archive.isCurrent);
  if (!current) throwNotFound();

  const record = await getPublishedArchiveDownloadRecord(runtime, current.id);
  if (!record || record.workId !== work.id) throwNotFound();

  const currentUser = await getCurrentUser(runtime);

  const [community, comments] = await Promise.all([
    getWorkCommunitySummary(runtime, work.id, currentUser?.id ?? null),
    listRootComments(
      runtime,
      { kind: "work", id: work.id },
      currentUser?.id ?? null,
      null,
    ),
  ]);

  const metadata: WebPlayMetadata = {
    ok: true,
    archiveVersionId: record.id,
    workId: record.workId,
    title: record.workChineseTitle || record.workOriginalTitle,
    originalTitle: record.workOriginalTitle,
    chineseTitle: record.workChineseTitle,
    coverBlobSha256: work.coverBlobSha256,
    manifestSha256: record.manifestSha256,
    downloadZipBuilderVersion,
    webPlayInstallerVersion,
    easyRpgRuntimeVersion,
    runtimeBasePath: easyRpgRuntimeBasePath,
    playKey: buildWebPlayKey({
      archiveVersionId: record.id,
      manifestSha256: record.manifestSha256,
    }),
    downloadUrl: buildWebPlayDownloadUrl(record.id),
    totalFiles: record.totalFiles,
    totalSizeBytes: record.totalSizeBytes,
    installTotalFiles: record.installTotalFiles,
    installTotalSizeBytes: record.installTotalSizeBytes,
    estimatedR2GetCount: record.estimatedR2GetCount,
    engineFamily: record.engineFamily,
  };

  return {
    record,
    currentUser: pickPageFields(currentUser, ["id"]),
    work,
    community,
    comments,
    current,
    metadata,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    { title: [loaderData?.metadata.title || "游戏", "在线游玩"] },
    error,
  );

export default function WebPlayPage() {
  const { record, currentUser, work, community: initialCommunity, comments, current, metadata } =
    useLoaderData<typeof loader>();
  const favorite = useWorkFavorite(initialCommunity);
  const { community } = favorite;
  const native = useSyncExternalStore(subscribeEnvironment, isAndroidClient, () => false);
  if (native) return <DetailPageShell>
    <WorkPageHeader chineseTitle={work.chineseTitle} originalTitle={work.originalTitle}
      coverBlobSha256={work.coverBlobSha256} engineFamily={work.engineFamily} language={work.language}
      tabs={[{ href: `/games/${work.id}`, label: "概览" }]} />
    <div className="mx-auto max-w-md py-8">
      <LocalInstallButton id={record.id} bytes={metadata.installTotalSizeBytes} title={metadata.title} workId={work.id} coverBlobSha256={work.coverBlobSha256} />
    </div>
  </DetailPageShell>;
  return (
    <DetailPageShell
      key={`${metadata.playKey}:${currentUser?.id ?? "anonymous"}`}
    >
      <WorkViewTracker workId={work.id} />
      <WorkPageHeader
        chineseTitle={work.chineseTitle}
        coverBlobSha256={work.coverBlobSha256}
        engineFamily={work.engineFamily}
        language={work.language}
        originalTitle={work.originalTitle}
        tabs={[
          { href: `/games/${work.id}`, label: "概览" },
          { href: `/play/${work.id}`, label: "在线游玩", active: true },
          {
            href: "#sec-comments",
            label: "评论",
            count: community.commentCount,
          },
          { href: `/games/${work.id}/collections`, label: "收藏与吐槽" },
        ]}
      />
      <WebPlayClient
        comments={
          <CommentPanel
            currentUserId={currentUser?.id ?? null}
            initialComments={comments.items}
            initialNextCursor={comments.nextCursor}
            target={{ kind: "work", id: work.id }}
          />
        }
        engagement={
          <WorkFavoriteButton
            summary="counts"
            onSaved={favorite.onSaved}
            currentUserId={currentUser?.id ?? null}
            initialFavorited={community.favoritedByMe}
            workId={work.id}
          />
        }
        metadata={metadata}
        notice={
          work.usesUnsupportedManiac ? (
            <WorkPageNotice>
              <AlertTriangle
                aria-hidden
                className="mt-0.5 shrink-0"
                size={16}
              />
              <span>该游戏使用了EasyRPG不支持的Maniac语法，可能无法正常在线游玩。</span>
            </WorkPageNotice>
          ) : null
        }
        secondary={<WorkSidebarInfo current={current} work={work} />}
        stats={
          <WorkCommunityStats
            commentCount={community.commentCount}
            favoriteCount={community.favoriteCount}
            collectionHref={`/games/${work.id}/collections`}
            playerCount={community.playerCount}
            viewCount={community.viewCount}
          />
        }
      />
    </DetailPageShell>
  );
}
