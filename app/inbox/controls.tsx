import type { InboxCategory } from "@/lib/inbox";
import { inboxHref } from "@/lib/inbox";
import { useTransition, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

export function InboxControls({
  category,
  pendingCount,
  canResolve,
  actions,
}: {
  category: InboxCategory;
  pendingCount: number;
  canResolve: boolean;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();

  const [pending, startTransition] = useTransition();
  const categories: Array<[InboxCategory, string]> = [
    ["all", "全部"],
    ["comments", "评论"],
    ["replies", "回复"],
    ["forum", "讨论版"],
    ["likes", "赞"],
    ["friends", "好友"],
    ["system", "系统"],
    ...(canResolve
      ? [["pending", `待处理 ${pendingCount}`] as [InboxCategory, string]]
      : []),
  ];
  return (
    <div
      id="inbox-controls"
      tabIndex={-1}
      aria-busy={pending}
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border py-3 focus-visible:outline-2 focus-visible:outline-primary"
    >
      <nav
        aria-label="提醒分类"
        className={`flex max-w-full gap-1 overflow-x-auto ${pending ? "pointer-events-none opacity-60" : ""}`}
      >
        {categories.map(([value, label]) => (
          <Link
            key={value}
            to={inboxHref(value)}
            prefetch="none"
            aria-current={category === value ? "page" : undefined}
            aria-disabled={pending}
            className={`inline-flex min-h-10 shrink-0 items-center border-b-2 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${category === value ? "border-primary bg-primary/5 text-foreground" : "border-transparent text-muted hover:bg-primary/5"}`}
            onClick={(event) => {
              event.preventDefault();
              if (!pending)
                startTransition(() =>
                  navigate(inboxHref(value), {
                    preventScrollReset: true,
                  }),
                );
            }}
          >
            {label}
          </Link>
        ))}
      </nav>
      {actions}
    </div>
  );
}
