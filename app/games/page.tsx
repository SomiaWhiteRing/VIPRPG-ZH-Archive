import Image from "next/image";
import Link from "next/link";
import { ChipList } from "@/app/components/ui/chip-list";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
import {
  listGameWorks,
  listPublicCharacters,
  listPublicTags,
  type GameWorkSummary,
} from "@/lib/server/db/game-library";
import { formatNumber, formatBytes } from "@/lib/format";
import { engineLabel } from "@/lib/labels";
import { stringParam } from "@/lib/params";

export const dynamic = "force-dynamic";

type GamesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GamesPage({ searchParams }: GamesPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q);
  const engine = stringParam(params.engine) || "all";
  const tag = stringParam(params.tag);
  const tagQuery = stringParam(params.tag_q);
  const character = stringParam(params.character);
  const [works, tags, characters] = await Promise.all([
    listGameWorks({ query, engine, tag, tagQuery, character }),
    listPublicTags(120),
    listPublicCharacters(120),
  ]);

  return (
    <main>
      <PageHeader
        eyebrow="Game Library"
        title="游戏资料库"
        subtitle="按作品浏览已归档的游戏。"
      />

      <form className="library-toolbar" action="/games" method="get">
        <label>
          <span>搜索</span>
          <input
            defaultValue={query}
            name="q"
            placeholder="标题、别名、作者、标签、角色"
            type="search"
          />
        </label>
        <label>
          <span>引擎</span>
          <select defaultValue={engine} name="engine">
            <option value="all">全部</option>
            <option value="rpg_maker_2000">RPG Maker 2000</option>
            <option value="rpg_maker_2003">RPG Maker 2003</option>
            <option value="mixed">混合</option>
            <option value="unknown">未知</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          <span>标签搜索</span>
          <input
            defaultValue={tagQuery}
            name="tag_q"
            placeholder="输入标签名"
            type="search"
          />
        </label>
        <label>
          <span>标签</span>
          <select defaultValue={tag} name="tag">
            <option value="">全部</option>
            {tags.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>登场角色</span>
          <select defaultValue={character} name="character">
            <option value="">全部</option>
            {characters.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.primaryName}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" type="submit">
          筛选
        </button>
        {(query || engine !== "all" || tag || tagQuery || character) ? (
          <Link className="button" href="/games">
            清除
          </Link>
        ) : null}
      </form>

      <section className="library-summary" aria-label="资料库摘要">
        <span>共</span>
        <strong>{formatNumber(works.length)}</strong>
        <span>个作品</span>
      </section>

      {works.length > 0 ? (
        <section className="game-card-grid" aria-label="作品列表">
          {works.map((work) => (
            <GameCard key={work.id} work={work} />
          ))}
        </section>
      ) : (
        <EmptyState title="没有找到匹配的作品。" />
      )}
    </main>
  );
}

function GameCard({ work }: { work: GameWorkSummary }) {
  const title = work.chineseTitle || work.originalTitle;

  return (
    <article className="game-card">
      <Link className="game-card-media" href={`/games/${work.slug}`}>
        {work.previewBlobSha256 ? (
          <Image
            alt={title}
            height={180}
            src={`/api/media/blobs/${work.previewBlobSha256}`}
            unoptimized
            width={320}
          />
        ) : (
          <span>{engineLabel(work.engineFamily)}</span>
        )}
      </Link>
      <div className="game-card-body">
        <div>
          <Link className="game-card-title" href={`/games/${work.slug}`}>
            {title}
          </Link>
          {work.chineseTitle ? (
            <span className="muted-line">{work.originalTitle}</span>
          ) : null}
        </div>
        {work.description ? <p>{work.description}</p> : null}
        <ChipList
          items={[
            { label: engineLabel(work.engineFamily) },
            ...(work.usesManiacsPatch ? [{ label: "Maniacs Patch" }] : []),
            ...work.tags.slice(0, 4).map((tag) => ({
              href: `/games?tag=${encodeURIComponent(tag.slug)}`,
              label: tag.name,
            })),
            ...work.characters.slice(0, 3).map((character) => ({
              href: `/games?character=${encodeURIComponent(character.slug)}`,
              label: `角色：${character.primaryName}`,
            })),
          ]}
        />
        <StatList
          columns={3}
          items={[
            { label: "发布", value: formatNumber(work.releaseCount) },
            { label: "归档", value: formatNumber(work.archiveVersionCount) },
            { label: "容量", value: formatBytes(work.totalSizeBytes) },
          ]}
          variant="tiles"
        />
      </div>
    </article>
  );
}
