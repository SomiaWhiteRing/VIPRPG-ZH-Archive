import { PageHeader } from "@/app/components/ui/page-header";
export default function InboxLoading() {
  return <main className="mx-auto w-[min(1280px,calc(100%-2rem))] py-8" aria-busy="true">
    <PageHeader compact title="提醒" /><p role="status" className="py-8 text-sm text-muted">正在加载提醒…</p>
  </main>;
}
