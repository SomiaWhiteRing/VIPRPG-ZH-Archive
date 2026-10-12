import { getGameWorkDetail } from "@/app/.server/db/game-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { runtimeContext } from "@/app/.server/router-context";
import { BackLink } from "@/app/components/ui/back-link";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { CHARACTER_ROLE_LABELS } from "../public-relations";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const workId = parsePositiveId(args.params.id ?? "", "work id");
  const work = await getGameWorkDetail(runtime, workId);
  if (!work) throwNotFound();
  return { workId, title: work.chineseTitle || work.originalTitle, characters: work.characters };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: [loaderData?.title || "游戏", "登场角色"] }, error);

export default function WorkCharactersPage() {
  const { workId, title, characters } = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-5 sm:py-8">
      <PageHeader
        actions={<BackLink href={`/games/${workId}#sec-cast`} label="返回作品" />}
        subtitle={title}
        title="登场角色"
      />
      {characters.length ? (
        <div aria-label="角色列表" className="flex flex-wrap gap-x-2.5 gap-y-5">
                  {characters.map((character, index) => (
                    <Link
                      className="group grid basis-24 shrink-0 content-start gap-1 text-foreground"
                      to={`/characters/${character.id}`}
                      key={`${character.id}:${index}`}
                    >
                      <CharacterPortrait
                        className="w-full text-2xl transition-shadow duration-150 group-hover:shadow-[0_3px_10px_rgb(23_33_43/14%)]"
                        displayName={character.displayName}
                        portrait={character.portrait}
                        size={96}
                        toneKey={index}
                      />
                      <span className="text-sm font-semibold wrap-anywhere">
                        {character.displayName}
                      </span>
                      <span
                        className={`inline-flex justify-self-start rounded-full border border-border bg-card px-2 py-[0.05rem] font-mono text-xs text-muted ${character.roleKey === "main" ? "border-primary/40 bg-primary/10 text-secondary" : ""}`}
                      >
                        {CHARACTER_ROLE_LABELS[character.roleKey] ?? "其他"}
                      </span>
                    </Link>
                  ))}
        </div>
      ) : <EmptyState title="暂无登场角色。" />}
    </main>
  );
}
