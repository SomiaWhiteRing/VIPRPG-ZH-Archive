import Link from "next/link";
import type { ReactNode } from "react";
import { engineLabel, languageLabel } from "@/lib/labels";
import { cn } from "@/lib/ui/cn";

export function WorkListSummary({ href, title, originalTitle, releaseDate, engineFamily, language, management, truncateOriginal = false, children }: {
  href: string;
  title: string;
  originalTitle?: string | null;
  releaseDate: string | null;
  engineFamily: string;
  language: string;
  management?: ReactNode;
  truncateOriginal?: boolean;
  children?: ReactNode;
}) {
  return <div className="min-w-0 flex-1">
    <div className="flex min-w-0 items-start gap-2">
      <Link className="min-w-0 flex-1 text-[15.5px] font-bold leading-[1.45] hover:text-primary hover:underline hover:underline-offset-3" href={href}>{title}</Link>
      {management ? <div className="shrink-0">{management}</div> : null}
    </div>
    {originalTitle ? <p className={cn("mt-0.5 text-[12.5px] text-muted", truncateOriginal && "truncate")}>{originalTitle}</p> : null}
    <p className="mt-1 font-mono text-xs text-muted">{[releaseDate, engineLabel(engineFamily), languageLabel(language)].filter(Boolean).join(" / ")}</p>
    {children}
  </div>;
}
