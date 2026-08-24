import type { ReactNode } from "react";
import { Card } from "@/app/components/ui/card";

type PaneProps = {
  tone?: "default" | "deep" | "danger";
  compact?: boolean;
  heading?: ReactNode;
  headingAction?: ReactNode;
  headingLevel?: 2 | 3;
  children: ReactNode;
};

export function Pane({
  tone = "default",
  compact = false,
  heading,
  headingAction,
  headingLevel = 2,
  children,
}: PaneProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <Card
      className={`${tone === "danger" ? "border-red-300 bg-red-50 text-red-950" : tone === "deep" ? "bg-muted/10" : ""} ${compact ? "p-4" : "p-5"}`}
    >
      {heading ? (
        <header className="mb-4 flex items-center justify-between gap-3">
          <Heading className="m-0 text-lg font-bold">{heading}</Heading>
          {headingAction}
        </header>
      ) : null}
      {children}
    </Card>
  );
}
