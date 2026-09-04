import type { ReactNode } from "react";
import { Card } from "@/app/components/ui/card";

export function WorkPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] pb-11 text-foreground max-[560px]:w-[calc(100%-1.5rem)]">
      {children}
    </main>
  );
}

export function WorkPageLayout({
  main,
  sidebar,
}: {
  main: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-[clamp(24px,3vw,40px)] pt-1 max-[980px]:flex max-[980px]:flex-col">
      <div className="min-w-0 max-[980px]:order-1 max-[980px]:w-full">{main}</div>
      <aside
        aria-label="作品操作与资料"
        className="sticky top-18.5 grid max-h-[calc(100dvh-5.5rem)] content-start gap-3.5 overflow-y-auto pr-1 max-[980px]:contents max-[980px]:overflow-visible"
      >
        {sidebar}
      </aside>
    </div>
  );
}

export function WorkSidebar({
  engagement,
  extras,
  mobilePrimaryFirst = false,
  notice,
  primary,
  secondary,
  stats,
}: {
  engagement?: ReactNode;
  extras?: ReactNode;
  mobilePrimaryFirst?: boolean;
  notice?: ReactNode;
  primary: ReactNode;
  secondary: ReactNode;
  stats?: ReactNode;
}) {
  return (
    <>
      <Card
        className={`rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-[0_8px_22px_rgb(23_33_43/10%)] max-[980px]:w-full max-[980px]:shadow-none ${
          mobilePrimaryFirst ? "max-[980px]:-order-1" : "max-[980px]:order-2"
        }`}
      >
        <div className="grid gap-3.5">
          {primary}
          {notice}
          {engagement ? (
            <>
              <hr className="h-px border-0 bg-border" />
              {engagement}
            </>
          ) : null}
          {stats ? (
            <>
              <hr className="h-px border-0 bg-border" />
              {stats}
            </>
          ) : null}
        </div>
      </Card>

      <Card
        aria-label="作品资料"
        className="order-2 rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full"
        id="infobox-card"
      >
        {secondary}
      </Card>

      {extras}
    </>
  );
}
