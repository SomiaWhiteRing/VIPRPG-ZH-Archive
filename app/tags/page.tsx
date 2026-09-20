import { listPublicTags } from "@/app/.server/db/taxonomy-library";
import { runtimeContext } from "@/app/.server/router-context";
import { TagCloud } from "@/app/components/library/tag-cloud";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { formatNumber } from "@/lib/format";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const tags = await listPublicTags(runtime);
  return { tags };
}

export const meta: MetaFunction<typeof loader> = ({ error }) =>
  pageMetaDescriptors({ title: "标签" }, error);

export default function TagsPage() {
  const { tags } = useLoaderData<typeof loader>();
  return (
    <PageContainer className="space-y-5">
      <PageHeader compact title="标签" />

      <section className="text-sm text-muted" aria-label="标签摘要">
        <span>共</span>
        <strong>{formatNumber(tags.length)}</strong>
        <span>个标签</span>
      </section>

      {tags.length > 0 ? (
        <TagCloud tags={tags} />
      ) : (
        <EmptyState title="暂无标签。" />
      )}
    </PageContainer>
  );
}
