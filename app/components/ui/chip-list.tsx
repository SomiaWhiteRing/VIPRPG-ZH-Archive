import { Badge } from "@/app/components/ui/badge";
import { Link } from "react-router";

type ChipListProps = {
  compact?: boolean;
  items: Array<{
    href?: string;
    label: string;
    external?: boolean;
  }>;
};

export function ChipList({ compact = false, items }: ChipListProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${compact ? "gap-1" : ""}`}
    >
      {items.map((item, index) =>
        item.href ? (
          <Link
            to={item.href}
            key={`${item.href}-${item.label}-${index}`}
            rel={item.external ? "noreferrer" : undefined}
            target={item.external ? "_blank" : undefined}
          >
            <Badge>{item.label}</Badge>
          </Link>
        ) : (
          <Badge key={`${item.label}-${index}`}>{item.label}</Badge>
        ),
      )}
    </div>
  );
}
