import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
        ) : null}
        <h1 className="m-0 text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h1>
        {subtitle ? <div className="mt-2 text-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
