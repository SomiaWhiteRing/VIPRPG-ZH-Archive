import Link from "next/link";
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Characters</p>
          <h1>登场角色</h1>
        </div>
      </header>

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
        <section className="creator-card-grid" aria-label="角色列表">
          {characters.map((character) => (
            <CharacterCard character={character} key={character.id} />
          ))}
        </section>
      ) : (
        <section className="card empty-card">
          <h2>没有找到匹配的角色。</h2>
        </section>
      )}
    </main>
  );
}

function CharacterCard({ character }: { character: PublicCharacterSummary }) {
  return (
    <article className="creator-card">
      <div>
        <Link className="creator-card-title" href={`/characters/${character.slug}`}>
          {character.primaryName}
        </Link>
        {character.originalName ? (
          <span className="muted-line">{character.originalName}</span>
        ) : null}
      </div>
      {character.description ? <p>{character.description}</p> : null}
      <dl className="game-card-stats">
        <div>
          <dt>登场作品</dt>
          <dd>{formatNumber(character.workCount)}</dd>
        </div>
      </dl>
    </article>
  );
}
