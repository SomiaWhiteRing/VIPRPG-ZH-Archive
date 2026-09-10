import type { ReactNode } from "react";
import { Card } from "@/app/components/ui/card";

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
