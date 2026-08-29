import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
};

export function PageHeader({ eyebrow, title, subtitle, actions, compact = false }: PageHeaderProps) {
  return (
    <header className={compact ? "flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4" : "mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6"} data-slot="page-header">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
        ) : null}
        <h1 className={compact ? "m-0 font-display text-[clamp(24px,3vw,30px)] font-bold leading-[1.2]" : "m-0 text-3xl font-extrabold tracking-tight md:text-4xl"}>{title}</h1>
        {subtitle ? <div className={compact ? "mt-1.5 text-sm text-muted" : "mt-2 text-muted"}>{subtitle}</div> : null}
      </div>
      {actions ? <div className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-wrap items-center gap-3"}>{actions}</div> : null}
    </header>
  );
}
