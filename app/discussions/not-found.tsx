import { PageContainer } from "@/app/components/ui/page-container";
import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
export default function DiscussionNotFound() {
  return (
    <PageContainer>
      <PageHeader compact title="内容不可用" />
      <Link prefetch={false} className="my-4 inline-block text-primary" href="/discussions">
        返回讨论版
      </Link>
    </PageContainer>
  );
}
