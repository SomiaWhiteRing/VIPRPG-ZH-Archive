import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { cn } from "@/lib/ui/cn";
import type { AriaRole, ReactNode } from "react";
import { Link } from "react-router";

type EmptyStateProps = {
  title: ReactNode;
  variant?: "card" | "plain";
  className?: string;
  role?: AriaRole;
  action?: {
    href: string;
    label: string;
  };
};

export function EmptyState({
  title,
  action,
  variant = "card",
  className,
  role,
}: EmptyStateProps) {
  const Container = variant === "plain" ? "div" : Card;

  return (
    <Container
      className={cn(
        "grid gap-3",
        variant === "card" ? "p-5" : "text-sm",
        className,
      )}
      role={role}
    >
      <p className="m-0 text-muted">{title}</p>
      {action ? (
        <Button asChild className="w-fit" variant="outline">
          <Link to={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </Container>
  );
}
