import { cn } from "@/lib/ui/cn";
import { Link } from "react-router";

export type SectionLink = {
  href: string;
  reloadDocument?: boolean;
  label: string;
  active?: boolean;
  count?: number;
};

export function SectionNavigation({
  items,
  className,
}: {
  items: SectionLink[];
  className?: string;
}) {
  return (
    <nav
      aria-label="页面分区"
      className={cn("mt-4 overflow-x-auto border-b border-border", className)}
    >
      <ul className="m-0 flex min-w-max list-none gap-0.5 p-0">
        {items.map((item) => (
          <li key={`${item.href}-${item.label}`}>
            <Link
              aria-current={
                item.active
                  ? item.href.startsWith("#")
                    ? "location"
                    : "page"
                  : undefined
              }
              className={cn(
                "inline-flex min-h-10.5 items-center gap-1.5 border-b-2 border-transparent px-3.25 text-sm whitespace-nowrap text-muted hover:border-border hover:text-foreground",
                item.active && "border-primary font-semibold text-secondary",
              )}
              to={item.href}
              reloadDocument={item.reloadDocument}
            >
              {item.label}
              {item.count !== undefined ? (
                <span className="font-mono text-xs text-muted">
                  {item.count}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
