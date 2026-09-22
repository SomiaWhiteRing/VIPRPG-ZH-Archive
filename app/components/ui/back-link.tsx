import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

type BackLinkProps = {
  href: string;
  label: string;
  variant?: "outline" | "text";
  className?: string;
};

export function BackLink({
  href,
  label,
  variant = "outline",
  className,
}: BackLinkProps) {
  const content = (
    <>
      <ArrowLeft aria-hidden className="size-4 shrink-0" />
      {label}
    </>
  );

  if (variant === "text") {
    return (
      <Link
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 text-sm text-muted hover:text-primary",
          className,
        )}
        to={href}
      >
        {content}
      </Link>
    );
  }

  return (
    <Button asChild className={className} variant="outline">
      <Link to={href}>{content}</Link>
    </Button>
  );
}
