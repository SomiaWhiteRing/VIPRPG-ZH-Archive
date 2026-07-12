import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getPublicSeriesDetail } from "@/lib/server/db/taxonomy-library";

export const dynamic = "force-dynamic";

type SeriesDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function SeriesDetailPage({ params }: SeriesDetailPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUserFromCookies();
  const [series, unreadInboxCount] = await Promise.all([
    getPublicSeriesDetail(slug),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  if (!series) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        actions={
          <>
            <BackLink href="/series" label="返回系列列表" />
            <Link className="button" href="/games">
              游戏资料库
            </Link>
            {currentUser ? <InboxLink unread={unreadInboxCount} /> : null}
          </>
        }
        eyebrow="Series"
        subtitle={series.titleOriginal}
        title={series.title}
      />

      <Pane heading="系列资料">
        {series.description ? <p>{series.description}</p> : null}
        <StatList items={[{ label: "收录作品", value: series.workCount }]} />
      </Pane>

      <Pane heading="系列作品">
        {series.works.length > 0 ? (
          <TableWrap compact label="系列作品" minWidth={760} mobileCards>
            <thead>
              <tr>
                <th>顺序</th>
                <th>作品</th>
                <th>关系</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {series.works.map((work) => (
                <tr key={work.workId}>
                  <td data-label="顺序">{work.positionLabel || work.positionNumber || "-"}</td>
                  <td data-label="作品">
                    <Link href={`/games/${work.slug}`}>{work.title}</Link>
                    {work.title !== work.originalTitle ? (
                      <span className="muted-line">{work.originalTitle}</span>
                    ) : null}
                  </td>
                  <td data-label="关系">{seriesRelationLabel(work.relationKind)}</td>
                  <td data-label="备注">{work.notes || "无"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <p className="muted-line">暂无公开系列作品。</p>
        )}
      </Pane>
    </main>
  );
}

function seriesRelationLabel(value: string): string {
  const labels: Record<string, string> = {
    main: "正篇",
    side: "外传",
    collection_member: "合集成员",
    same_setting: "同世界观",
    other: "其他",
  };

  return labels[value] ?? value;
}
