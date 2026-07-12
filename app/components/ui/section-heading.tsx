import type { ReactNode } from "react";

type SectionHeadingProps = {
  title: ReactNode;
  eyebrow?: string;
  action?: ReactNode;
  level?: 2 | 3;
  divided?: boolean;
};

export function SectionHeading({
  title,
  eyebrow,
  action,
  level = 2,
  divided = false,
}: SectionHeadingProps) {
  const Heading = level === 3 ? "h3" : "h2";

  return (
    <div className={`section-heading${divided ? " section-heading--divided" : ""}`}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <Heading>{title}</Heading>
      </div>
      {action}
    </div>
  );
}
