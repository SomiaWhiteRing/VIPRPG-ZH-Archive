import type { InboxCategory } from "@/lib/inbox";
import { inboxHref } from "@/lib/inbox";
import { useTransition, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";

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
  const t = useMessages();

  const [pending, startTransition] = useTransition();
  const categories: Array<[InboxCategory, string]> = [
    ["all", t("library.all")],
    ["comments", t("work.stats.commentsShort")],
    ["replies", t("forum.replyHeading")],
    ["forum", t("core.nav.discussions")],
    ["likes", t("inbox.likes")],
    ["friends", t("account.privacy.friends")],
    ["system", t("inbox.system")],
    ...(canResolve
      ? [["pending", t("inbox.pending", { count: pendingCount })] as [InboxCategory, string]]
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
        aria-label={t("inbox.categories")}
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
              if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              const href = event.currentTarget.pathname + event.currentTarget.search + event.currentTarget.hash;
              if (!pending)
                startTransition(() =>
                  navigate(href, {
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
