import {
  SectionNavigation,
  type SectionLink,
} from "@/app/components/ui/section-navigation";
import { engineLabel, languageLabel } from "@/lib/labels";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export function WorkPageHeader({
  chineseTitle,
  engineFamily,
  language,
  originalTitle,
  tabs,
}: {
  chineseTitle: string | null;
  engineFamily: string;
  language: string;
  originalTitle: string;
  tabs: SectionLink[];
}) {
  const title = chineseTitle || originalTitle;

  return (
    <header className="pt-4">
      <Link
        className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted hover:text-[#1f6f67]"
        to="/games"
      >
        <ArrowLeft aria-hidden size={15} />
        作品库
      </Link>
      <h1 className="mt-2 font-serif text-3xl font-bold leading-tight max-[560px]:text-2xl">
        {title}
        {chineseTitle ? (
          <span
            className="ml-2 font-mono text-base font-normal text-muted"
            lang="ja"
          >
            {originalTitle}
          </span>
        ) : null}
      </h1>
      <div
        aria-label="元信息"
        className="mt-[0.7rem] flex flex-wrap items-center gap-2"
      >
        <span className="inline-flex min-h-[1.6rem] items-center rounded-full border border-rm2k-green-2 bg-rm2k-green-2 px-[0.6rem] py-[0.15rem] font-mono text-xs tracking-[0.04em] text-white">
          {engineLabel(engineFamily)}
        </span>
        <span className="inline-flex min-h-[1.6rem] items-center rounded-full border border-primary/40 bg-card px-[0.6rem] py-[0.15rem] font-mono text-xs tracking-[0.04em] text-[#1f6f67]">
          {languageLabel(language)}
        </span>
      </div>

      <SectionNavigation items={tabs} />
    </header>
  );
}

export function WorkPageNotice({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex gap-2.5 rounded-lg border border-[#b47800]/35 bg-[#fff7df] px-3 py-2.5 text-sm text-[#684a00]"
      role="note"
    >
      {children}
    </div>
  );
}
