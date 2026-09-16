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
  const error = useRouteError();
  const revalidator = useRevalidator();
  if (isRouteErrorResponse(error) && error.status === 404)
    return <DiscussionNotFound />;
  return (
    <PageContainer>
      <PageHeader compact title="讨论版" />
      <p className="my-4" role="alert">
        讨论加载失败。
      </p>
      <Button onClick={() => void revalidator.revalidate()} type="button">
        重试
      </Button>
    </PageContainer>
  );
}
