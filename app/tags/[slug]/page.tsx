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
import { getPublicTagDetail } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { engineLabel, namespaceLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

type TagDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function TagDetailPage({ params }: TagDetailPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUserFromCookies();
  const [tag, unreadInboxCount] = await Promise.all([
    getPublicTagDetail(slug),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  if (!tag) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        actions={
          <>
            <BackLink href="/tags" label="返回标签列表" />
            <Link className="button" href={`/games?tag=${encodeURIComponent(tag.slug)}`}>
              筛选作品
            </Link>
            {currentUser ? <InboxLink unread={unreadInboxCount} /> : null}
          </>
        }
        eyebrow="Tag"
        subtitle={tag.description || namespaceLabel(tag.namespace)}
        title={tag.name}
      />

      <Pane heading="标签资料">
        <StatList
          items={[
            { label: "分类", value: namespaceLabel(tag.namespace) },
            { label: "关联作品", value: formatNumber(tag.workCount) },
            { label: "关联发布版本", value: formatNumber(tag.releaseCount) },
          ]}
        />
      </Pane>

      <Pane heading="关联作品">
        {tag.works.length > 0 ? (
          <TableWrap compact label="关联作品" minWidth={760} mobileCards>
            <thead>
              <tr>
                <th>作品</th>
                <th>引擎</th>
                <th>归档</th>
              </tr>
            </thead>
            <tbody>
              {tag.works.map((work) => (
                <tr key={work.id}>
                  <td data-label="作品">
                    <Link href={`/games/${work.slug}`}>
                      {work.chineseTitle || work.originalTitle}
                    </Link>
                    {work.chineseTitle ? (
                      <span className="muted-line">{work.originalTitle}</span>
                    ) : null}
                  </td>
                  <td data-label="引擎">{engineLabel(work.engineFamily)}</td>
                  <td data-label="归档">{formatNumber(work.archiveVersionCount)} 个归档</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <p className="muted-line">暂无公开关联作品。</p>
        )}
      </Pane>
    </main>
  );
}
