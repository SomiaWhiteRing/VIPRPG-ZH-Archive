import { RichMessage } from "@/app/components/ui/rich-message";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
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
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { stringParam } from "@/lib/params";
import { cn } from "@/lib/ui/cn";
import { Search } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

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

  return { locale: runtime.uiLocale, query, sort, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "creator.title");
  return pageMetaDescriptors({ title: loaderData?.query ? [translate(locale, "search.titleQuery", { query: loaderData.query }), title] : title, page: loaderData?.result.page }, error, locale);
};

export default function CreatorsPage() {
  const t = useMessages();
  const locale = useNavigationLocale();
  const { query, sort, result } = useLoaderData<typeof loader>();
  const activeParams = {
    q: query || undefined,
    sort: sort === "works" ? sort : undefined,
  };

  return (
    <PageContainer>
      <PageHeader
        compact
        title={t("creator.title")}
        actions={
          <span className="text-sm text-muted">
            <RichMessage id={query ? "creator.found" : "creator.count"} values={{ count: result.total }} components={{ emphasis: children => <strong key="count" className="tabular-nums text-foreground">{children}</strong> }} />
          </span>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-5">
        <Form
          action="/creators"
          className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1 sm:max-w-lg"
          method="get"
          role="search"
          aria-label={t("creator.search")}
        >
          <Label className="sr-only" htmlFor="creator-search">
            {t("creator.nameAlias")}
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
              placeholder={t("creator.placeholder")}
              type="search"
            />
          </div>
          {sort === "works" ? (
            <input name="sort" type="hidden" value={sort} />
          ) : null}
          {locale && <input name={UI_LOCALE_PARAM} type="hidden" value={locale} />}
          <Button type="submit">{t("search.submit")}</Button>
          {query ? (
            <Link
              className={buttonVariants({ variant: "ghost" })}
              to={creatorsHref("", sort)}
            >
              {t("creator.clear")}
            </Link>
          ) : null}
        </Form>

        <nav
          aria-label={t("creator.sort")}
          className="flex items-center gap-4 text-sm text-muted"
        >
          <span className="text-xs">{t("library.sort")}</span>
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
              {value === "name" ? t("creator.name") : t("creator.worksCount")}
            </Link>
          ))}
        </nav>
      </div>

      {result.items.length ? (
        <section aria-label={t("creator.list")}>
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
              ? t("creator.searchEmpty")
              : t("creator.empty")
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
