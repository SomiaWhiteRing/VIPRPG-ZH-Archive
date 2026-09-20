import { GameCard } from "@/app/components/home/game-card";
import { EmptyState } from "@/app/components/ui/empty-state";
import type { UserWorkListItem } from "@/lib/dto/db/game-library";
import { formatDate } from "@/lib/format";
import type { ReactNode } from "react";
import { Link } from "react-router";

export function AccountSection({
  title,
  href,
  status,
  children,
}: {
  title: string;
  href: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <header className="mb-3 flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="m-0 text-lg font-bold">{title}</h2>
          {status}
        </div>
        <Link
          className="shrink-0 text-sm font-semibold text-primary hover:underline"
          to={href}
        >
          更多 →
        </Link>
      </header>
      {children}
    </section>
  );
}

export function AccountWorkGrid({ items, showPlayedAt = false }: { items: UserWorkListItem[]; showPlayedAt?: boolean }) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item, index) => (
        <li
          className={index >= 2 ? "hidden sm:block" : undefined}
          key={item.work.id}
        >
          <GameCard work={item.work}>
            {showPlayedAt ? (
              <p className="mt-1 text-xs text-muted wrap-anywhere">
                最近游玩：{formatDate(item.occurredAt)}
              </p>
            ) : null}
          </GameCard>
        </li>
      ))}
    </ul>
  );
}

export function AccountEmpty({ children }: { children: ReactNode }) {
  return (
    <EmptyState
      title={children}
      variant="plain"
      className="rounded-md border border-dashed border-border px-4 py-5 text-sm text-muted"
    />
  );
}
