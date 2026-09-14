"use client";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
export default function InboxError({ reset }: { reset: () => void }) {
  return <main className="mx-auto w-[min(1280px,calc(100%-2rem))] py-8">
    <PageHeader compact title="提醒" />
    <div role="alert" className="py-8"><p className="mb-3">提醒加载失败。</p><Button variant="outline" onClick={reset}>重试</Button></div>
  </main>;
}
