import Link from "next/link";
import type { PublicSeriesSummary } from "@/lib/server/db/taxonomy-library";

type FacetLink = { href: string; label: string; active?: boolean };

export function LibraryFacetIndex({
  engines,
  series,
}: {
  engines: FacetLink[];
  series: PublicSeriesSummary[];
}) {
  return (
    <section className="mb-7 grid gap-4 rounded-lg border border-border bg-card p-5" aria-label="游戏库分类索引">
      <FacetGroup links={engines} title="引擎" />
      <FacetGroup
        links={series.map((item) => ({
          href: `/series/${item.slug}`,
          label: item.title,
        }))}
        title="系列"
      />
    </section>
  );
}

function FacetGroup({ links, title }: { links: FacetLink[]; title: string }) {
  return (
    <div className="grid gap-2 md:grid-cols-[72px_minmax(0,1fr)] md:gap-4">
      <h2>{title}</h2>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {links.map((link) => (
          <Link
            className={
              link.active
                ? "text-primary underline decoration-2 underline-offset-4"
                : "text-foreground hover:text-accent"
            }
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
