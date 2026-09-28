import { PageHeader } from "@/app/components/ui/page-header";
import type { ComponentProps } from "react";
import { MobileAccountNavigation } from "./mobile-account-navigation";

type AccountPageHeaderProps = ComponentProps<typeof PageHeader> & {
  parentTitle?: string;
};

export function AccountPageHeader({ title, parentTitle, ...props }: AccountPageHeaderProps) {
  return (
    <>
      {parentTitle ? (
        <div className="mb-3 md:hidden">
          <MobileAccountNavigation>{parentTitle}</MobileAccountNavigation>
        </div>
      ) : null}
      <PageHeader
        {...props}
        title={parentTitle ? title : (
          <>
            <span className="md:hidden">
              <MobileAccountNavigation heading>{title}</MobileAccountNavigation>
            </span>
            <span className="hidden md:inline">{title}</span>
          </>
        )}
      />
    </>
  );
}
