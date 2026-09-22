import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/lib/ui/cn";
import {
  ChevronFirst,
  ChevronLast,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Form, Link } from "react-router";

const DESKTOP_PAGE_COUNT = 10;
const MOBILE_PAGE_COUNT = 5;

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  className?: string;
  ariaLabel?: string;
} & (
  | {
      basePath: string;
      params?: Record<string, string | readonly string[] | undefined>;
      prefetch?: false;
      onPageChange?: never;
      disabled?: never;
    }
  | {
      basePath?: never;
      params?: never;
      prefetch?: never;
      onPageChange: (page: number) => void;
      disabled?: boolean;
    }
);

export function PaginationLinks({
  basePath,
  page,
  pageSize,
  params,
  total,
  onPageChange,
  disabled = false,
  className,
  ariaLabel = "分页",
}: PaginationProps) {
  const JumpForm = onPageChange ? "form" : Form;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const desktopPages = pageWindow(page, totalPages, DESKTOP_PAGE_COUNT);
  const mobilePages = new Set(pageWindow(page, totalPages, MOBILE_PAGE_COUNT));
  const makeHref = (nextPage: number) => {
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value)
        for (const item of typeof value === "string" ? [value] : value)
          query.append(key, item);
    });
    query.delete("page");
    if (nextPage > 1) query.set("page", String(nextPage));
    return `${basePath}${query.size ? `?${query.toString()}` : ""}`;
  };
  return (
    <nav
      className={cn("my-8 flex flex-wrap items-center justify-start gap-2", className)}
      aria-label={ariaLabel}
      aria-busy={disabled || undefined}
    >
      <div className="flex max-w-full items-center justify-center gap-1.5">
        {page > 1 ? (
          <>
            <PageControl
              onPageChange={onPageChange}
              disabled={disabled}
              aria-label="首页"
              className={cn(paginationItem, "hidden sm:inline-flex")}
              page={1}
              href={onPageChange ? undefined : makeHref(1)}
            >
              <ChevronFirst aria-hidden />
            </PageControl>
            <PageControl
              onPageChange={onPageChange}
              disabled={disabled}
              aria-label="上一页"
              className={paginationItem}
              page={page - 1}
              href={onPageChange ? undefined : makeHref(page - 1)}
            >
              <ChevronsLeft aria-hidden />
            </PageControl>
          </>
        ) : null}
        {desktopPages.map((pageNumber) =>
          pageNumber === page ? (
            <span
              aria-current="page"
              className={cn(
                paginationItem,
                activePaginationItem,
                !mobilePages.has(pageNumber) && "hidden sm:inline-flex",
              )}
              key={pageNumber}
            >
              {pageNumber}
            </span>
          ) : (
            <PageControl
              onPageChange={onPageChange}
              disabled={disabled}
              aria-label={`第 ${pageNumber} 页`}
              className={cn(
                paginationItem,
                !mobilePages.has(pageNumber) && "hidden sm:inline-flex",
              )}
              page={pageNumber}
              href={onPageChange ? undefined : makeHref(pageNumber)}
              key={pageNumber}
            >
              {pageNumber}
            </PageControl>
          ),
        )}
        {page < totalPages ? (
          <>
            <PageControl
              onPageChange={onPageChange}
              disabled={disabled}
              aria-label="下一页"
              className={paginationItem}
              page={page + 1}
              href={onPageChange ? undefined : makeHref(page + 1)}
            >
              <ChevronsRight aria-hidden />
            </PageControl>
            <PageControl
              onPageChange={onPageChange}
              disabled={disabled}
              aria-label="末页"
              className={cn(paginationItem, "hidden sm:inline-flex")}
              page={totalPages}
              href={onPageChange ? undefined : makeHref(totalPages)}
            >
              <ChevronLast aria-hidden />
            </PageControl>
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <JumpForm
          action={basePath}
          className="contents"
          onSubmit={onPageChange ? (event) => {
            event.preventDefault();
            if (disabled) return;
            const value = Number(new FormData(event.currentTarget).get("page"));
            if (Number.isSafeInteger(value) && value >= 1 && value <= totalPages)
              onPageChange(value);
          } : undefined}
        >
          {Object.entries(params ?? {}).flatMap(([key, value]) =>
            value && key !== "page"
              ? (typeof value === "string" ? [value] : value).map(
                  (item, index) => (
                    <input
                      key={`${key}-${index}`}
                      name={key}
                      type="hidden"
                      value={item}
                    />
                  ),
                )
              : [],
          )}
          <Input
            aria-label={`跳转页码，范围 1 到 ${totalPages}`}
            autoComplete="off"
            disabled={disabled}
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
        </JumpForm>
        <span className="font-mono text-xs tabular-nums text-muted">
          ( {page} / {totalPages} )
        </span>
      </div>
    </nav>
  );
}

function PageControl({
  page,
  href,
  onPageChange,
  disabled,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  page: number;
  href?: string;
  onPageChange?: (page: number) => void;
  disabled: boolean;
  className: string;
  children: ReactNode;
  "aria-label": string;
}) {
  return onPageChange ? (
    <Button
      type="button"
      variant="neutral"
      size="icon"
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onPageChange(page)}
    >
      {children}
    </Button>
  ) : (
    <Link prefetch="none" className={className} aria-label={ariaLabel} to={href!}>
      {children}
    </Link>
  );
}

const paginationItem = cn(
  buttonVariants({ size: "icon", variant: "neutral" }),
  "h-8 w-auto min-w-8 rounded-md px-2 py-0 text-xs tabular-nums sm:text-sm",
);
const activePaginationItem =
  "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground";

function pageWindow(page: number, totalPages: number, size: number): number[] {
  const count = Math.min(size, totalPages);
  const maxStart = totalPages - count + 1;
  const start = Math.min(
    Math.max(1, page - Math.floor((count - 1) / 2)),
    maxStart,
  );
  return Array.from({ length: count }, (_, index) => start + index);
}
