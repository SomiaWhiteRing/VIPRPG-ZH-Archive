import type { ReactNode } from "react";

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
    <section className={`pane pane--${tone}${compact ? " pane--compact" : ""}`}>
      {heading ? (
        <header className="pane-header">
          <Heading>{heading}</Heading>
          {headingAction}
        </header>
      ) : null}
      {children}
    </section>
  );
}
