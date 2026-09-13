import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
export default function DiscussionNotFound() {
  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-6">
      <PageHeader compact title="内容不可用" />
      <Link className="my-4 inline-block text-primary" href="/discussions">
        返回讨论
      </Link>
    </main>
  );
}
