import { useMessages } from "@/lib/i18n/react";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import {
  isRouteErrorResponse,
  useRevalidator,
  useRouteError,
} from "react-router";
import NotFound from "@/app/not-found";
export default function InboxError() {
  const t = useMessages();
  const error = useRouteError();
  const revalidator = useRevalidator();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return (
    <main className="mx-auto w-[min(1280px,calc(100%-2rem))] py-8">
      <PageHeader compact title={t("header.inbox")} />
      <div role="alert" className="py-8">
        <p className="mb-3">{t("inbox.ui.loadFailed")}</p>
        <Button variant="outline" onClick={() => void revalidator.revalidate()}>
          {t("core.action.retry")}
        </Button>
      </div>
    </main>
  );
}
