import Link from "next/link";

export function PaginationLinks({
  basePath,
  page,
  hasNext,
  params,
}: {
  basePath: string;
  page: number;
  hasNext: boolean;
  params?: Record<string, string | undefined>;
}) {
  if (page <= 1 && !hasNext) return null;
  const makeHref = (nextPage: number) => {
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    query.set("page", String(nextPage));
    return `${basePath}?${query.toString()}`;
  };
  return (
    <nav className="my-8 flex items-center justify-center gap-2" aria-label="分页">
      {page > 1 ? <Link href={makeHref(page - 1)}>上一页</Link> : <span aria-hidden="true">上一页</span>}
      <strong aria-current="page">{page}</strong>
      {hasNext ? <Link href={makeHref(page + 1)}>下一页</Link> : <span aria-hidden="true">下一页</span>}
    </nav>
  );
}
