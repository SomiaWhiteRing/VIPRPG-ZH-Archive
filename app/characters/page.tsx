import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
import {
  listPublicCharacters,
  type PublicCharacterSummary,
} from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";

export const dynamic = "force-dynamic";

type CharactersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CharactersPage({ searchParams }: CharactersPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q);
  const characters = await listPublicCharacters({ query });

  return (
    <main>
      <PageHeader eyebrow="Characters" title="登场角色" />

      <form className="library-toolbar" action="/characters" method="get">
        <label>
          <span>搜索</span>
          <input defaultValue={query} name="q" placeholder="角色名、原名" type="search" />
        </label>
        <button className="button primary" type="submit">
          筛选
        </button>
        {query ? (
          <Link className="button" href="/characters">
            清除
          </Link>
        ) : null}
      </form>

      <section className="library-summary" aria-label="角色摘要">
        <strong>共 {formatNumber(characters.length)} </strong>
        <span>位角色</span>
      </section>

      {characters.length > 0 ? (
        <section className="directory-card-grid" aria-label="角色列表">
          {characters.map((character) => (
            <CharacterCard character={character} key={character.id} />
          ))}
        </section>
      ) : (
        <EmptyState title="没有找到匹配的角色。" />
      )}
    </main>
  );
}

function CharacterCard({ character }: { character: PublicCharacterSummary }) {
  return (
    <article className="directory-card">
      <div>
        <Link className="directory-card-title" href={`/characters/${character.slug}`}>
          {character.primaryName}
        </Link>
        {character.originalName ? (
          <span className="muted-line">{character.originalName}</span>
        ) : null}
      </div>
      {character.description ? <p>{character.description}</p> : null}
      <StatList
        columns={3}
        items={[{ label: "登场作品", value: formatNumber(character.workCount) }]}
        variant="tiles"
      />
    </article>
  );
}
