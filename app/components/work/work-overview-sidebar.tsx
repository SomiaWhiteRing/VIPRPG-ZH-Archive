import { CatalogListRow } from "@/app/catalogs/catalog-list-row";
import { Card } from "@/app/components/ui/card";
import { WorkCommunityStats } from "@/app/components/work/work-community-stats";
import { WorkSidebar } from "@/app/components/work/work-page-layout";
import { WorkSidebarInfo } from "@/app/components/work/work-sidebar-info";
import { WorkActionBar } from "@/app/games/[id]/work-action-bar";
import { CatalogAddDialog, WorkEngagementActions } from "@/app/games/[id]/work-engagement-actions";
import type { GameWorkDetail } from "@/lib/dto/db/game-library";
import type { WorkOverviewSidebarData } from "@/lib/dto/db/work-community";
import { ExternalLink, Link2 } from "lucide-react";
import { Link } from "react-router";

export function WorkOverviewSidebar({ work, data }: { work: GameWorkDetail; data: WorkOverviewSidebarData }) {
  const { currentUser, community, containingCatalogs, userCatalogs, showRelationEditor, editInfoHref } = data;
  const current = work.archiveVersions[0] ?? null;
  const externalDownload = work.externalLinks.find((link) => link.linkType === "download_page") ?? null;
  const externalLinks = work.externalLinks.filter((link) => link.linkType !== "download_page");
  return (
    <WorkSidebar
      engagement={
        <WorkEngagementActions
          currentUserId={currentUser?.id ?? null}
          initialFavorited={community.favoritedByMe}
          workId={work.id}
        />
      }
      extras={
        <>
          {currentUser ? (
            <div aria-label="条目补充操作" className="order-2 flex items-center gap-1 px-2 max-[980px]:w-full">
              {showRelationEditor ? (
                <Link className="min-w-0 flex-1 shrink px-1 text-center text-sm font-medium text-secondary hover:underline" to={`/games/${work.id}/relations`}>
                  编辑关联
                </Link>
              ) : null}
              {editInfoHref ? (
                <Link className="min-w-0 flex-1 shrink px-1 text-center text-sm font-medium text-secondary hover:underline" to={editInfoHref}>
                  编辑信息
                </Link>
              ) : null}
              <CatalogAddDialog catalogs={userCatalogs} workId={work.id} />
            </div>
          ) : null}
          {containingCatalogs.length ? (
            <Card className="order-2 rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full" id="catalog-card">
              <div className="mb-[0.35rem] flex items-baseline justify-between gap-3">
                <h2 className="m-0 font-mono text-xs font-normal tracking-[0.08em] text-muted">收录了本条目的目录</h2>
                <Link aria-label="查看全部收录了本条目的目录" className="shrink-0 text-sm font-medium text-secondary hover:underline" to={`/games/${work.id}/catalogs`}>
                  更多
                </Link>
              </div>
              {containingCatalogs.map((catalog) => (
                <div className="border-b border-dashed border-border last:border-b-0" key={catalog.id}>
                  <CatalogListRow catalog={catalog} compact />
                </div>
              ))}
            </Card>
          ) : null}
          {externalLinks.length ? (
            <Card className="order-2 rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full" id="links-card">
              <p className="my-[0.65rem] mb-[0.35rem] mt-0 font-mono text-xs tracking-[0.08em] text-muted">外部链接</p>
              <div className="grid gap-0.5">
                {externalLinks.map((link) => (
                  <a
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-secondary hover:bg-foreground/5"
                    href={link.url}
                    key={link.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {link.linkType === "official" ? <Link2 aria-hidden size={14} /> : <ExternalLink aria-hidden size={14} />}
                    {link.label}
                  </a>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      }
      mobilePrimaryFirst
      primary={
        <WorkActionBar
          title={work.chineseTitle || work.originalTitle}
          coverBlobSha256={work.coverBlobSha256}
          engineFamily={work.engineFamily}
          archive={current ? {
            id: current.id,
            totalFiles: current.totalFiles,
            totalSizeBytes: current.totalSizeBytes,
            embeddedPlayerSizeBytes: current.embeddedPlayerSizeBytes,
            downloadSizeBytes: work.downloadSizeBytes,
            webPlayFileCount: current.webPlayFileCount,
            webPlaySizeBytes: current.webPlaySizeBytes,
          } : null}
          externalDownload={externalDownload ? { url: externalDownload.url } : null}
          isAuthenticated={Boolean(currentUser)}
          workId={work.id}
        />
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
  );
}
