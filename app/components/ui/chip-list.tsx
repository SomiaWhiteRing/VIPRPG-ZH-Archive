import Link from "next/link";

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
    <div className={`chip-list${compact ? " compact-chip-list" : ""}`}>
      {items.map((item, index) =>
        item.href ? (
          <Link
            href={item.href}
            key={`${item.href}-${item.label}-${index}`}
            rel={item.external ? "noreferrer" : undefined}
            target={item.external ? "_blank" : undefined}
          >
            {item.label}
          </Link>
        ) : (
          <span key={`${item.label}-${index}`}>{item.label}</span>
        ),
      )}
    </div>
  );
}
