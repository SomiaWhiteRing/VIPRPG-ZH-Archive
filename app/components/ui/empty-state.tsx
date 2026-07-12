import Link from "next/link";

type EmptyStateProps = {
  title: string;
  action?: {
    href: string;
    label: string;
  };
};

export function EmptyState({ title, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      {action ? (
        <Link className="button" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
