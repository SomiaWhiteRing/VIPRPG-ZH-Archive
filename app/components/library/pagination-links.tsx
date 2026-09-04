import Link from "next/link";
import Form from "next/form";
import { ChevronFirst, ChevronLast, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { buttonVariants } from "@/app/components/ui/button";
import { cn } from "@/lib/ui/cn";

const DESKTOP_PAGE_COUNT = 10;
const MOBILE_PAGE_COUNT = 5;

export function PaginationLinks({
  basePath,
  page,
  pageSize,
  params,
  total,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  params?: Record<string, string | undefined>;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const desktopPages = pageWindow(page, totalPages, DESKTOP_PAGE_COUNT);
  const mobilePages = new Set(pageWindow(page, totalPages, MOBILE_PAGE_COUNT));
  const makeHref = (nextPage: number) => {
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    query.set("page", String(nextPage));
    return `${basePath}?${query.toString()}`;
  };
  return (
    <nav className="my-8 flex flex-wrap items-center justify-start gap-2" aria-label="分页">
      <div className="flex max-w-full items-center justify-center gap-1.5">
        {page > 1 ? (
          <>
            <Link aria-label="首页" className={cn(paginationItem, "hidden sm:inline-flex")} href={makeHref(1)}>
              <ChevronFirst aria-hidden />
            </Link>
            <Link aria-label="上一页" className={paginationItem} href={makeHref(page - 1)}>
              <ChevronsLeft aria-hidden />
            </Link>
          </>
        ) : null}
        {desktopPages.map((pageNumber) =>
          pageNumber === page ? (
            <span
              aria-current="page"
              className={cn(paginationItem, activePaginationItem, !mobilePages.has(pageNumber) && "hidden sm:inline-flex")}
              key={pageNumber}
            >
              {pageNumber}
            </span>
          ) : (
            <Link
              aria-label={`第 ${pageNumber} 页`}
              className={cn(paginationItem, !mobilePages.has(pageNumber) && "hidden sm:inline-flex")}
              href={makeHref(pageNumber)}
              key={pageNumber}
            >
              {pageNumber}
            </Link>
          ),
        )}
        {page < totalPages ? (
          <>
            <Link aria-label="下一页" className={paginationItem} href={makeHref(page + 1)}>
              <ChevronsRight aria-hidden />
            </Link>
            <Link aria-label="末页" className={cn(paginationItem, "hidden sm:inline-flex")} href={makeHref(totalPages)}>
              <ChevronLast aria-hidden />
            </Link>
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Form action={basePath} className="contents">
          {Object.entries(params ?? {}).map(([key, value]) =>
            value && key !== "page" ? <input key={key} name={key} type="hidden" value={value} /> : null,
          )}
          <Input
            aria-label={`跳转页码，范围 1 到 ${totalPages}`}
            autoComplete="off"
            className="h-8 w-14 px-2 text-center font-mono text-xs tabular-nums sm:w-16"
            inputMode="numeric"
            max={totalPages}
            min={1}
            name="page"
            placeholder="页码"
            required
            step={1}
            title={`输入 1 到 ${totalPages} 的页码并按回车`}
            type="number"
          />
        </Form>
        <span className="font-mono text-xs tabular-nums text-muted">
          ( {page} / {totalPages} )
        </span>
      </div>
    </nav>
  );
}

const paginationItem = cn(
  buttonVariants({ size: "icon", variant: "secondary" }),
  "h-8 w-auto min-w-8 rounded-md px-2 py-0 text-xs tabular-nums sm:text-sm",
);
const activePaginationItem = "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground";

function pageWindow(page: number, totalPages: number, size: number): number[] {
  const count = Math.min(size, totalPages);
  const maxStart = totalPages - count + 1;
  const start = Math.min(Math.max(1, page - Math.floor((count - 1) / 2)), maxStart);
  return Array.from({ length: count }, (_, index) => start + index);
}
