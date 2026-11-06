import { isAndroidClient } from "@/lib/browser/client-environment";
import { useEffect, useState } from "react";
import { BackLink } from "@/app/components/ui/back-link";
import {
  SectionNavigation,
  type SectionLink,
} from "@/app/components/ui/section-navigation";
import { engineLabel, languageLabel } from "@/lib/labels";
import type { ReactNode } from "react";

export function WorkHeader({ title, originalTitle, coverSrc, beforeTitle, children, titleAs: Title = "h1", variant = "page" }: {
  title: ReactNode;
  originalTitle?: string | null;
  coverSrc?: string;
  beforeTitle?: ReactNode;
  children?: ReactNode;
  titleAs?: "h1" | "h2";
  variant?: "page" | "dialog";
}) {
  return <header className={variant === "dialog" ? "local-library-heading relative isolate overflow-hidden px-5 py-5 sm:px-7" : "relative isolate pt-4"}>
      {coverSrc ? <img alt="" className={`pointer-events-none absolute right-0 top-0 -z-10 w-[70%] object-cover object-right [mask-image:linear-gradient(to_right,transparent,black)] max-[560px]:opacity-30 ${variant === "dialog" ? "h-full" : "h-[calc(100%+1rem)] max-[560px]:-right-3 max-[560px]:w-[calc(70%+0.75rem)]"}`} src={coverSrc} /> : null}
      {beforeTitle}
      <Title className="mt-2 font-serif text-3xl font-bold leading-tight max-[560px]:text-2xl">
        {title}
        {originalTitle ? <span className="ml-2 font-mono text-base font-normal text-muted" lang="ja">{originalTitle}</span> : null}
      </Title>
      {children}
  </header>;
}

export function WorkPageHeader({
  chineseTitle,
  coverBlobSha256,
  engineFamily,
  language,
  originalTitle,
  tabs,
}: {
  chineseTitle: string | null;
  coverBlobSha256?: string | null;
  engineFamily: string;
  language: string;
  originalTitle: string;
  tabs: SectionLink[];
}) {
  const [native, setNative] = useState(false);
  useEffect(() => { setNative(isAndroidClient()); }, []);
  const title = chineseTitle || originalTitle;

  return (
    <>
      <WorkHeader title={title} originalTitle={chineseTitle ? originalTitle : null}
        coverSrc={coverBlobSha256 ? `/api/media/blobs/${coverBlobSha256}` : undefined}
        beforeTitle={<BackLink href="/games" label="作品库" variant="text" />}>
          <div
            aria-label="元信息"
            className="mt-[0.7rem] flex flex-wrap items-center gap-2"
          >
            <span className="inline-flex min-h-[1.6rem] items-center rounded-full border border-rm2k-green-2 bg-rm2k-green-2 px-[0.6rem] py-[0.15rem] font-mono text-xs tracking-[0.04em] text-white">
              {engineLabel(engineFamily)}
            </span>
            <span className="inline-flex min-h-[1.6rem] items-center rounded-full border border-primary/40 bg-card px-[0.6rem] py-[0.15rem] font-mono text-xs tracking-[0.04em] text-secondary">
              {languageLabel(language)}
            </span>
          </div>
      </WorkHeader>

      <SectionNavigation
        className="sticky top-[var(--site-header-height,3.5rem)] z-30 bg-background"
        items={native ? tabs.filter(tab => !tab.href.startsWith("/play/")) : tabs}
      />
    </>
  );
}

export function WorkPageNotice({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex gap-2.5 rounded-lg border border-[#b47800]/35 bg-[#fff7df] px-3 py-2.5 text-sm text-[#684a00] dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200"
      role="note"
    >
      {children}
    </div>
  );
}
