import { Button, rm2kSurfaceClassName } from "@/app/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { ArrowUpRight, Download } from "lucide-react";
import type { ReactNode } from "react";

type ResourceEntryProps = {
  id: string;
  title: string;
  iconSrc: string;
  sourceUrl?: string;
  children: ReactNode;
  actions: ReactNode;
};

export function ResourceEntry({
  id,
  title,
  iconSrc,
  sourceUrl,
  children,
  actions,
}: ResourceEntryProps) {
  return (
    <article
      aria-labelledby={`${id}-heading`}
      className="relative isolate grid min-w-0 scroll-mt-24 grid-cols-[1.5rem_1.5rem_minmax(0,1fr)] sm:grid-cols-[2rem_2rem_minmax(0,1fr)]"
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
          sourceUrl && "max-w-[calc(100%-3.5rem)]",
        )}
        id={`${id}-heading`}
      >
        {title}
      </h2>
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${title} 项目网站`}
          title="项目网站"
          className="absolute top-6 right-2 z-20 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:top-8"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="size-6">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      ) : null}

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
      <a href={href} target="_blank" rel="noopener noreferrer">
        <Icon aria-hidden="true" />
        {children}
      </a>
    </Button>
  );
}
