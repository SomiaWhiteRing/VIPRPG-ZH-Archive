import Link from "next/link";
import type { ReactNode } from "react";
import { GameCard } from "@/app/components/home/game-card";
import type { UserWorkListItem } from "@/lib/server/db/game-library";

export function AccountSection({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <header className="mb-3 flex items-center justify-between gap-4">
        <h2 className="m-0 text-lg font-bold">{title}</h2>
        <Link className="shrink-0 text-sm font-semibold text-primary hover:underline" href={href}>
          更多 →
        </Link>
      </header>
      {children}
    </section>
  );
}

export function AccountWorkGrid({ items }: { items: UserWorkListItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item, index) => (
        <li className={index >= 2 ? "hidden sm:block" : undefined} key={item.work.id}>
          <GameCard work={item.work} />
        </li>
      ))}
    </ul>
  );
}

export function AccountEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border px-4 py-5 text-sm text-muted">{children}</p>;
}
