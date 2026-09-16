import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Link } from "react-router";
export default function DiscussionNotFound() {
  return (
    <PageContainer>
      <PageHeader compact title="内容不可用" />
      <Link
        prefetch="none"
        className="my-4 inline-block text-primary"
        to="/discussions"
      >
        返回讨论版
      </Link>
    </PageContainer>
  );
}
