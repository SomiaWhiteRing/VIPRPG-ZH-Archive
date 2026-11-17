import { useMessages } from "@/lib/i18n/react";
import { Button } from "@/app/components/ui/button";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import {
  isRouteErrorResponse,
  useRevalidator,
  useRouteError,
} from "react-router";
import DiscussionNotFound from "./not-found";
export default function DiscussionError() {
  const t = useMessages();
  const error = useRouteError();
  const revalidator = useRevalidator();
  if (isRouteErrorResponse(error) && error.status === 404)
    return <DiscussionNotFound />;
  return (
    <PageContainer>
      <PageHeader compact title={t("core.nav.discussions")} />
      <p className="my-4" role="alert">
        {t("forum.loadError")}
      </p>
      <Button onClick={() => void revalidator.revalidate()} type="button">
        {t("core.action.retry")}
      </Button>
    </PageContainer>
  );
}
