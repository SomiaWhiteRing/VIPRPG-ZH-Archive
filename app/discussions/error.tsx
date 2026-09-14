"use client";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
export default function DiscussionError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-6">
      <PageHeader compact title="讨论版" />
      <p className="my-4" role="alert">
        讨论加载失败。
      </p>
      <Button onClick={reset} type="button">
        重试
      </Button>
    </main>
  );
}
