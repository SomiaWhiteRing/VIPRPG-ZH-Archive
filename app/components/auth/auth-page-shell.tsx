import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import type { ReactNode } from "react";

export function AuthPageShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <PageContainer>
      <PageHeader compact title={title} subtitle={subtitle} />
      <div className="mx-auto mt-5 max-w-md">
        <Pane>
          {children}
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-primary">
            {footer}
          </div>
        </Pane>
      </div>
    </PageContainer>
  );
}
