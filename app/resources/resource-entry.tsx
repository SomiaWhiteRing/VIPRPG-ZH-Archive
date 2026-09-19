import { Button, rm2kSurfaceClassName } from "@/app/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { ArrowUpRight, Download } from "lucide-react";
import type { ReactNode } from "react";

type ResourceEntryProps = {
  id: string;
  title: string;
  iconSrc: string;
  children: ReactNode;
  actions: ReactNode;
};

export function ResourceEntry({
  id,
  title,
  iconSrc,
  children,
  actions,
}: ResourceEntryProps) {
  return (
    <article
      aria-labelledby={`${id}-heading`}
      className="isolate grid min-w-0 scroll-mt-24 grid-cols-[1.5rem_1.5rem_minmax(0,1fr)] sm:grid-cols-[2rem_2rem_minmax(0,1fr)]"
      id={id}
    >
      <div
        aria-hidden="true"
        className="relative z-20 col-span-2 col-start-1 row-start-1 grid aspect-square w-full translate-x-1/4 place-items-center self-start overflow-hidden rounded-lg border border-border bg-card p-2"
      >
        <img
          src={iconSrc}
          alt=""
          width={64}
          height={64}
          className="size-full object-contain"
        />
      </div>
      <h2
        className={cn(
          rm2kSurfaceClassName,
          "relative top-6 z-10 col-span-2 col-start-2 row-start-1 m-0 ml-1.5 flex min-h-10 w-fit min-w-0 max-w-full -translate-y-1/2 items-center self-start justify-self-start rounded-md py-2 pr-3 pl-9 text-lg leading-tight font-bold tracking-tight [overflow-wrap:anywhere] sm:top-8 sm:ml-2 sm:min-h-11 sm:pr-3.5 sm:pl-12 sm:text-xl",
        )}
        id={`${id}-heading`}
      >
        {title}
      </h2>

      <div className="relative col-span-2 col-start-2 row-start-1 mt-6 flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card sm:mt-8">
        <div className="flex-1 pt-8 pr-3.5 pb-3.5 pl-4.5 text-sm leading-6 sm:pt-10 sm:pr-4 sm:pb-4 sm:pl-6">
          {children}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3.5 py-2.5 sm:px-4">
          {actions}
        </div>
      </div>
    </article>
  );
}

export function ResourceAction({
  href,
  children,
  download = false,
  secondary = false,
}: {
  href: string;
  children: ReactNode;
  download?: boolean;
  secondary?: boolean;
}) {
  const Icon = download ? Download : ArrowUpRight;

  return (
    <Button
      asChild
      size="sm"
      className="min-h-10 sm:min-h-9"
      variant={secondary ? "outline" : "default"}
    >
      <a href={href}>
        <Icon aria-hidden="true" />
        {children}
      </a>
    </Button>
  );
}
