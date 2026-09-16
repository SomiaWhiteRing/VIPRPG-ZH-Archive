import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import {
  isRouteErrorResponse,
  useRevalidator,
  useRouteError,
} from "react-router";
import NotFound from "@/app/not-found";
export default function InboxError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return (
    <main className="mx-auto w-[min(1280px,calc(100%-2rem))] py-8">
      <PageHeader compact title="提醒" />
      <div role="alert" className="py-8">
        <p className="mb-3">提醒加载失败。</p>
        <Button variant="outline" onClick={() => void revalidator.revalidate()}>
          重试
        </Button>
      </div>
    </main>
  );
}
