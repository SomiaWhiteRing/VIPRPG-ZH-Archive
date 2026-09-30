import { browsePublicCharacterWorks } from "@/app/.server/db/character-detail";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { runtimeContext } from "@/app/.server/router-context";
import { CharacterWorkList } from "@/app/characters/character-work-list";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const id = parsePositiveId(args.params.id ?? "", "character id");
  const result = await browsePublicCharacterWorks(runtime, id, {
    page: Number(new URL(args.request.url).searchParams.get("page") || "1"),
    pageSize: 20,
  });
  if (!result) throwNotFound();
  return result;
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({
    title: [loaderData?.character.primaryName || "角色", "登场作品"],
    page: loaderData?.page,
  }, error);

export default function CharacterWorksPage() {
  const { character, items, page, pageSize, total } = useLoaderData<typeof loader>();
  return (
    <PageContainer>
      <PageHeader
        actions={<BackLink href={`/characters/${character.id}#sec-works`} label="返回角色" />}
        subtitle={character.primaryName}
        title="登场作品"
      />
      {items.length ? (
        <CharacterWorkList works={items} standalone />
      ) : <EmptyState title="暂无登场作品。" />}
      <PaginationLinks
        basePath={`/characters/${character.id}/works`}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </PageContainer>
  );
}
