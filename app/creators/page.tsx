import { browsePublicCreators } from "@/app/.server/db/creator-library";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { CreatorCard } from "@/app/creators/creator-card";
import { formatNumber } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { stringParam } from "@/lib/params";
import { cn } from "@/lib/ui/cn";
import { Search } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData } from "react-router";

const PAGE_SIZE = 30;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  const query = stringParam(params.q).trim();
  const sort: "name" | "works" =
    stringParam(params.sort) === "works" ? "works" : "name";
  const result = await browsePublicCreators(runtime, {
    query,
    sort,
    page: Number(stringParam(params.page) || "1"),
    pageSize: PAGE_SIZE,
  });

  return { query, sort, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: loaderData?.query
        ? [`“${loaderData.query}”的搜索结果`, "作者与制作人员"]
        : "作者与制作人员",
      page: loaderData?.result.page,
    },
    error,
  );

export default function CreatorsPage() {
  const { query, sort, result } = useLoaderData<typeof loader>();
  const activeParams = {
    q: query || undefined,
    sort: sort === "works" ? sort : undefined,
  };

  return (
    <PageContainer>
      <PageHeader
        compact
        title="作者与制作人员"
        actions={
          <span className="text-sm text-muted">
            {query ? "找到 " : "共 "}
            <strong className="tabular-nums text-foreground">
              {formatNumber(result.total)}
            </strong>{" "}
            位
          </span>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-5">
        <Form
          action="/creators"
          className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1 sm:max-w-lg"
          method="get"
          role="search"
          aria-label="搜索作者"
        >
          <Label className="sr-only" htmlFor="creator-search">
            作者名或别名
          </Label>
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-3 text-muted"
              size={16}
            />
            <Input
              className="pl-9 shadow-none"
              defaultValue={query}
              id="creator-search"
              key={query}
              name="q"
              placeholder="搜索作者名或别名……"
              type="search"
            />
          </div>
          {sort === "works" ? (
            <input name="sort" type="hidden" value={sort} />
          ) : null}
          <Button type="submit">搜索</Button>
          {query ? (
            <Link
              className={buttonVariants({ variant: "ghost" })}
              to={creatorsHref("", sort)}
            >
              清除
            </Link>
          ) : null}
        </Form>

        <nav
          aria-label="作者排序"
          className="flex items-center gap-4 text-sm text-muted"
        >
          <span className="text-xs">排序</span>
          {(["name", "works"] as const).map((value) => (
            <Link
              aria-current={sort === value ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center rounded-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                sort === value ? "text-primary" : "hover:text-foreground",
              )}
              key={value}
              to={creatorsHref(query, value)}
            >
              {value === "name" ? "名称" : "作品数"}
            </Link>
          ))}
        </nav>
      </div>

      {result.items.length ? (
        <section aria-label="作者列表">
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 md:gap-4">
            {result.items.map((creator) => (
              <li className="min-w-0" key={creator.id}>
                <CreatorCard creator={creator} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState
          className="border-y border-border py-8"
          title={
            query
              ? "没有找到匹配的作者，试试其他名字或别名。"
              : "还没有收录公开作品的作者。"
          }
          variant="plain"
        />
      )}

      <PaginationLinks
        basePath="/creators"
        page={result.page}
        pageSize={result.pageSize}
        params={activeParams}
        total={result.total}
      />
    </PageContainer>
  );
}

function creatorsHref(query: string, sort: "name" | "works"): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (sort === "works") params.set("sort", sort);
  return `/creators${params.size ? `?${params.toString()}` : ""}`;
}
