import type { ReactNode } from "react";

type SectionHeadingProps = {
  title: ReactNode;
  eyebrow?: string;
  action?: ReactNode;
  level?: 2 | 3;
  divided?: boolean;
};

export function SectionHeading({ title, eyebrow, action, level = 2, divided = false }: SectionHeadingProps) {
  const Heading = level === 3 ? "h3" : "h2";

  return (
    <div className={`flex items-end justify-between gap-4 ${divided ? "mt-5 border-t border-border pt-4" : "mb-4"}`}>
      <div>
        {eyebrow ? (
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
        ) : null}
        <Heading className="m-0 text-xl font-bold">{title}</Heading>
      </div>
      {action}
    </div>
  );
}
