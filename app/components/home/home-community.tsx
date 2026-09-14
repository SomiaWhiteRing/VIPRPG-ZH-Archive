import { EmptyState } from "@/app/components/ui/empty-state";
import Link from "next/link";
import type { PublicForumTopic } from "@/lib/forum-public";

const directoryLinks = [
  { href: "/creators", label: "作者名录" },
  { href: "/characters", label: "角色图鉴" },
  { href: "/tags", label: "作品标签" },
  { href: "/catalogs", label: "专题目录" },
];

export function HomeCommunity({ topics }: { topics: PublicForumTopic[] }) {
  return (
    <aside
      className="min-w-0 scroll-mt-24 border-t border-foreground pt-5 min-[851px]:border-t-0 min-[851px]:border-l min-[851px]:border-border min-[851px]:pt-0 min-[851px]:pl-5 min-[1101px]:pl-6"
      id="community"
      aria-labelledby="community-heading"
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight" id="community-heading">讨论区</h2>
        <Link className="shrink-0 text-sm font-bold text-primary hover:text-accent" href="/discussions">
          进入 →
        </Link>
      </div>
      {topics.length ? (
        <ul className="grid min-[561px]:grid-cols-2 min-[561px]:gap-x-7 min-[851px]:grid-cols-1">
          {topics.map((topic) => (
            <li className="min-w-0 border-b border-border" key={topic.id}>
              <Link
                className="group block py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                href={`/discussions/${topic.id}`}
              >
                <h3 className="text-sm leading-7 font-medium wrap-anywhere group-hover:text-primary">
                  {topic.title}
                </h3>
                <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-relaxed text-muted">
                  <span className="wrap-anywhere">{topic.author.name}</span>
                  <span>{topic.replies} 回复</span>
                  {topic.tags[0] ? <span className="wrap-anywhere">{topic.tags[0].name}</span> : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="目前还没有公开讨论。" variant="plain" className="py-4" />}

      <section className="mt-7 border-t-2 border-foreground pt-4" aria-labelledby="directory-heading">
        <h2 className="mb-3 text-base font-bold" id="directory-heading">随处逛逛</h2>
        <nav className="grid grid-cols-2 gap-x-4 gap-y-2.5 min-[561px]:grid-cols-4 min-[851px]:grid-cols-2" aria-label="分类浏览">
          {directoryLinks.map((link) => (
            <Link className="text-sm text-muted hover:text-primary" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <Link className="mt-5 inline-block text-sm font-bold text-primary hover:text-accent" href="/about">
          关于本站 →
        </Link>
      </section>
    </aside>
  );
}
