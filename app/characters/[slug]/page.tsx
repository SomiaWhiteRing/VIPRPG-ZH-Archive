import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatList } from "@/app/components/ui/stat-list";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { getPublicCharacterDetail } from "@/lib/server/db/taxonomy-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatNumber } from "@/lib/format";
import { engineLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

type CharacterDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function CharacterDetailPage({ params }: CharacterDetailPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUserFromCookies();
  const [character, unreadInboxCount] = await Promise.all([
    getPublicCharacterDetail(slug),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  if (!character) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        actions={
          <>
            <BackLink href="/characters" label="返回角色列表" />
            <Link className="button" href={`/games?character=${encodeURIComponent(character.slug)}`}>
              筛选作品
            </Link>
            {currentUser ? <InboxLink unread={unreadInboxCount} /> : null}
          </>
        }
        eyebrow="Character"
        subtitle={character.originalName}
        title={character.primaryName}
      />

      <section className="section-grid creator-profile-grid" aria-label="角色资料">
        {character.description ? (
          <Pane heading="简介">
            <p>{character.description}</p>
          </Pane>
        ) : null}
        <Pane heading="关联统计">
          <StatList items={[{ label: "登场作品", value: formatNumber(character.workCount) }]} />
        </Pane>
      </section>

      <section className="creator-credit-section" aria-label="登场作品">
        <SectionHeading title="登场作品" />
        {character.works.length > 0 ? (
          <TableWrap compact label="登场作品" minWidth={760}>
            <thead>
              <tr>
                <th>作品</th>
                <th>引擎</th>
                <th>归档</th>
              </tr>
            </thead>
            <tbody>
              {character.works.map((work) => (
                <tr key={work.id}>
                  <td>
                    <Link href={`/games/${work.slug}`}>
                      {work.chineseTitle || work.originalTitle}
                    </Link>
                    {work.chineseTitle ? (
                      <span className="muted-line">{work.originalTitle}</span>
                    ) : null}
                  </td>
                  <td>{engineLabel(work.engineFamily)}</td>
                  <td>{formatNumber(work.archiveVersionCount)} 个归档</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <p className="muted-line">暂无公开登场作品。</p>
        )}
      </section>
    </main>
  );
}
