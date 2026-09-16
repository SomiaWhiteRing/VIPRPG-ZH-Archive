import { listPublicCreators } from "@/app/.server/db/creator-library";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
import type { PublicCreatorSummary } from "@/lib/dto/db/creator-library";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  const query = stringParam(params.q);
  const creators = await listPublicCreators(runtime, { query });

  return { query, creators };
}

export default function CreatorsPage() {
  const { query, creators } = useLoaderData<typeof loader>();
  return (
    <PageContainer className="space-y-5">
      <PageHeader compact title="作者与制作人员" />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
        action="/creators"
        method="get"
      >
        <Label>
          <span>搜索</span>
          <Input
            defaultValue={query}
            name="q"
            placeholder="作者名或别名"
            type="search"
          />
        </Label>
        <Button type="submit">筛选</Button>
        {query ? (
          <Link
            className={buttonVariants({ variant: "outline" })}
            to="/creators"
          >
            清除
          </Link>
        ) : null}
      </form>

      <section className="text-sm text-muted" aria-label="作者摘要">
        <strong>共 {formatNumber(creators.length)} </strong>
        <span>位作者或制作人员</span>
      </section>

      {creators.length > 0 ? (
        <section
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
          aria-label="作者列表"
        >
          {creators.map((creator) => (
            <CreatorCard creator={creator} key={creator.id} />
          ))}
        </section>
      ) : (
        <EmptyState title="没有找到匹配的作者。" />
      )}
    </PageContainer>
  );
}

function CreatorCard({ creator }: { creator: PublicCreatorSummary }) {
  return (
    <article className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div>
        <Link
          className="text-lg font-bold text-primary hover:text-accent"
          to={`/creators/${creator.id}`}
        >
          {creator.name}
        </Link>
      </div>
      {creator.bio ? <p>{creator.bio}</p> : null}
      <StatList
        columns={3}
        items={[
          { label: "作品", value: formatNumber(creator.workCreditCount) },
          { label: "参与游戏", value: formatNumber(creator.workCreditCount) },
        ]}
        variant="tiles"
      />
    </article>
  );
}
