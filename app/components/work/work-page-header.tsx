import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { engineLabel, languageLabel } from "@/lib/labels";

type WorkPageTab = {
  href: string;
  label: string;
  active?: boolean;
  count?: number;
};

export function WorkPageHeader({
  aliases,
  chineseTitle,
  engineFamily,
  language,
  originalTitle,
  tabs,
}: {
  aliases?: string[];
  chineseTitle: string | null;
  engineFamily: string;
  language: string;
  originalTitle: string;
  tabs: WorkPageTab[];
}) {
  const title = chineseTitle || originalTitle;

  return (
    <header className="pt-4">
      <Link className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted hover:text-[#1f6f67]" href="/games">
        <ArrowLeft aria-hidden size={15} />
        游戏库
      </Link>
      <h1 className="mt-2 font-serif text-3xl font-bold leading-tight max-[560px]:text-2xl">
        {title}
        {chineseTitle ? (
          <span className="ml-2 font-mono text-base font-normal text-muted" lang="ja">
            {originalTitle}
          </span>
        ) : null}
      </h1>
      {aliases?.length ? (
        <p className="mt-[0.4rem] text-sm text-muted">
          又名：<span className="font-mono text-foreground">{aliases.join(" · ")}</span>
        </p>
      ) : null}
      <div aria-label="元信息" className="mt-[0.7rem] flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-[1.6rem] items-center rounded-full border border-rm2k-green-2 bg-rm2k-green-2 px-[0.6rem] py-[0.15rem] font-mono text-xs tracking-[0.04em] text-white">
          {engineLabel(engineFamily)}
        </span>
        <span className="inline-flex min-h-[1.6rem] items-center rounded-full border border-primary/40 bg-card px-[0.6rem] py-[0.15rem] font-mono text-xs tracking-[0.04em] text-[#1f6f67]">
          {languageLabel(language)}
        </span>
      </div>

      <nav aria-label="页面分区" className="mt-4 overflow-x-auto border-b border-border">
        <ul className="m-0 flex min-w-max list-none gap-0.5 p-0">
          {tabs.map((tab) => (
            <li key={`${tab.href}-${tab.label}`}>
              <Link
                aria-current={tab.active ? "page" : undefined}
                className={`inline-flex min-h-10.5 items-center gap-1.5 border-b-2 border-transparent px-3.25 text-sm whitespace-nowrap text-muted hover:border-border hover:text-foreground ${
                  tab.active ? "border-primary font-semibold text-[#1f6f67]" : ""
                }`}
                href={tab.href}
              >
                {tab.label}
                {tab.count !== undefined ? <span className="font-mono text-xs text-muted">{tab.count}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

export function WorkPageNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-[#b47800]/35 bg-[#fff7df] px-3 py-2.5 text-sm text-[#684a00]" role="note">
      {children}
    </div>
  );
}
