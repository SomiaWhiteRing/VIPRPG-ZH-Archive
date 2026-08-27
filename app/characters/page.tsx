import { Input } from "@/app/components/ui/input";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
import { listPublicCharacters, type PublicCharacterSummary } from "@/lib/server/db/taxonomy-library";
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
      <PageHeader title="登场角色" />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
        action="/characters"
        method="get"
      >
        <Label>
          <span>搜索</span>
          <Input defaultValue={query} name="q" placeholder="角色名、原名" type="search" />
        </Label>
        <Button type="submit">筛选</Button>
        {query ? (
          <Link className={buttonVariants({ variant: "outline" })} href="/characters">
            清除
          </Link>
        ) : null}
      </form>

      <section className="text-sm text-muted" aria-label="角色摘要">
        <strong>共 {formatNumber(characters.length)} </strong>
        <span>位角色</span>
      </section>

      {characters.length > 0 ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="角色列表">
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
    <article className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div>
        <Link
          className="text-lg font-bold text-primary hover:text-accent"
          href={`/games?character=${character.id}`}
        >
          {character.primaryName}
        </Link>
        {character.originalName ? <span className="text-sm text-muted">{character.originalName}</span> : null}
      </div>
      {character.description ? <p>{character.description}</p> : null}
      <StatList columns={3} items={[{ label: "登场作品", value: formatNumber(character.workCount) }]} variant="tiles" />
    </article>
  );
}
