import type { ReactNode } from "react";

export function NestedReply({
  id,
  children,
  metadata,
  actions,
}: {
  id: string;
  children: ReactNode;
  metadata: ReactNode;
  actions: ReactNode;
}) {
  return (
    <article
      id={id}
      tabIndex={-1}
      className="group min-w-0 scroll-mt-24 border-b border-border/50 py-2 focus:bg-primary/5 focus-visible:outline focus-visible:outline-primary target:bg-primary/5"
    >
      <div className="break-words text-[15px] leading-[1.7] [overflow-wrap:anywhere]">
        {children}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="mr-auto text-xs text-muted">{metadata}</span>
        {actions}
      </div>
    </article>
  );
}

export const nestedRepliesClassName =
  "mt-3 border-l-2 border-border bg-muted/10 p-2 focus-visible:outline focus-visible:outline-primary sm:p-3";
