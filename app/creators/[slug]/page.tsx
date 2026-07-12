import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { getPublicCreatorDetail } from "@/lib/server/db/creator-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatNumber } from "@/lib/format";
import { creatorRoleLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

type CreatorDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function CreatorDetailPage({ params }: CreatorDetailPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUserFromCookies();
  const [creator, unreadInboxCount] = await Promise.all([
    getPublicCreatorDetail(slug),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  if (!creator) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        actions={
          <>
            <BackLink href="/creators" label="返回作者列表" />
            <Link className="button" href="/games">
              游戏资料库
            </Link>
            {currentUser ? <InboxLink unread={unreadInboxCount} /> : null}
          </>
        }
        eyebrow="Creator"
        subtitle={creator.originalName}
        title={creator.name}
      />

      <Pane heading="作者资料">
        {creator.bio ? <p>{creator.bio}</p> : null}
        <StatList
          items={[
            { label: "作品层职务", value: formatNumber(creator.workCreditCount) },
            { label: "发布版本职务", value: formatNumber(creator.releaseCreditCount) },
            { label: "最近发布关联", value: creator.latestReleaseCreditAt ?? "暂无" },
          ]}
        />
        {creator.websiteUrl ? (
          <div className="actions">
            <a className="button" href={creator.websiteUrl} rel="noreferrer" target="_blank">
              个人链接
            </a>
          </div>
        ) : null}
      </Pane>

      <Pane heading="作品年表">
        {creator.workCredits.length > 0 ? (
          <TableWrap compact label="作品年表" minWidth={760} mobileCards>
            <thead>
              <tr>
                <th>作品</th>
                <th>职务</th>
                <th>日期</th>
              </tr>
            </thead>
            <tbody>
              {creator.workCredits.map((credit) => (
                <tr key={`${credit.workId}-${credit.roleKey}`}>
                  <td data-label="作品">
                    <Link href={`/games/${credit.workSlug}`}>{credit.workTitle}</Link>
                    {credit.workTitle !== credit.workOriginalTitle ? (
                      <span className="muted-line">{credit.workOriginalTitle}</span>
                    ) : null}
                  </td>
                  <td data-label="职务">
                    {credit.roleLabel || creatorRoleLabel(credit.roleKey)}
                    {credit.notes ? <span className="muted-line">{credit.notes}</span> : null}
                  </td>
                  <td data-label="日期">{credit.originalReleaseDate ?? "未知"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <p className="muted-line">暂无作品层职务记录。</p>
        )}
      </Pane>

      <Pane heading="发布参与">
        {creator.releaseCredits.length > 0 ? (
          <TableWrap compact label="发布参与" minWidth={760} mobileCards>
            <thead>
              <tr>
                <th>作品 / 发布版本</th>
                <th>职务</th>
                <th>日期</th>
              </tr>
            </thead>
            <tbody>
              {creator.releaseCredits.map((credit) => (
                <tr key={`${credit.releaseId}-${credit.roleKey}`}>
                  <td data-label="作品 / 发布版本">
                    <Link href={`/games/${credit.workSlug}`}>{credit.workTitle}</Link>
                    <span className="muted-line">{credit.releaseLabel}</span>
                  </td>
                  <td data-label="职务">
                    {credit.roleLabel || creatorRoleLabel(credit.roleKey)}
                    {credit.notes ? <span className="muted-line">{credit.notes}</span> : null}
                  </td>
                  <td data-label="日期">{credit.releaseDate ?? "未知"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <p className="muted-line">暂无发布版本职务记录。</p>
        )}
      </Pane>
    </main>
  );
}
