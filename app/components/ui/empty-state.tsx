import Link from "next/link";
import { Card } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";

type EmptyStateProps = {
  title: string;
  action?: {
    href: string;
    label: string;
  };
};

export function EmptyState({ title, action }: EmptyStateProps) {
  return (
    <Card className="grid gap-3 p-5">
      <p className="m-0 text-muted">{title}</p>
      {action ? (
        <Button asChild className="w-fit" variant="outline">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </Card>
  );
}
