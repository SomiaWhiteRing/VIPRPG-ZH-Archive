import { useMessages } from "@/lib/i18n/react";
import { EmptyState } from "@/app/components/ui/empty-state";
import { AndroidClientBanner } from "./android-client-banner";
import { cn } from "@/lib/ui/cn";
import type { HomeForumTopic } from "@/lib/forum-public";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

const directoryLinks = [
  { href: "/creators", label: "home.creators" },
  { href: "/characters", label: "home.characters" },
  { href: "/tags", label: "home.tags" },
  { href: "/catalogs", label: "home.collections" },
] as const;

export function HomeCommunity({ topics, className }: { topics: HomeForumTopic[]; className?: string }) {
  const t = useMessages();
  return (
    <aside
      className={cn("min-w-0 scroll-mt-24 border-t border-foreground pt-5 min-[981px]:border-t-0 min-[981px]:border-l min-[981px]:border-border min-[981px]:pt-0 min-[981px]:pl-5 min-[1101px]:pl-6", className)}
      id="community"
      aria-labelledby="community-heading"
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 wrap-anywhere text-xl font-bold tracking-tight" id="community-heading">
          {t("home.community")}
        </h2>
        <Link
          className="shrink-0 whitespace-nowrap text-sm font-bold text-primary hover:text-accent"
          to="/discussions"
        >
          {t("home.enter")}
        </Link>
      </div>
      {topics.length ? (
        <ul className="grid min-[561px]:grid-cols-2 min-[561px]:gap-x-7 min-[851px]:grid-cols-1">
          {topics.map((topic) => (
            <li className="min-w-0 border-b border-border" key={topic.id}>
              <Link
                className="group block py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                to={`/discussions/${topic.id}`}
              >
                <h3 className="text-sm leading-7 font-medium wrap-anywhere group-hover:text-primary">
                  {topic.title}
                </h3>
                <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-relaxed text-muted">
                  <span className="wrap-anywhere">{topic.authorName}</span>
                  <span>{t("forum.replyCount", { count: topic.replies })}</span>
                  {topic.tagName ? (
                    <span className="wrap-anywhere">{topic.tagName}</span>
                  ) : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={t("home.noTopics")}
          variant="plain"
          className="py-4"
        />
      )}

      <section
        className="mt-7 border-t-2 border-foreground pt-4"
        aria-labelledby="directory-heading"
      >
        <h2 className="mb-3 text-base font-bold" id="directory-heading">
          {t("home.browse")}
        </h2>
        <nav
          className="grid grid-cols-2 gap-x-4 gap-y-2.5 min-[561px]:grid-cols-4 min-[851px]:grid-cols-2"
          aria-label={t("home.browseNav")}
        >
          {directoryLinks.map((link) => (
            <Link
              className="text-sm text-muted hover:text-primary"
              to={link.href}
              key={link.href}
            >
              {t(link.label)}
            </Link>
          ))}
        </nav>
        <Link
          className="mt-5 inline-block text-sm font-bold text-primary hover:text-accent"
          to="/about"
        >
          {t("home.about")}
        </Link>
      </section>
      <AndroidClientBanner />
    </aside>
  );
}
