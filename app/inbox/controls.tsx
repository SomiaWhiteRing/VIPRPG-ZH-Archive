"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { inboxHref, type InboxCategory } from "@/lib/inbox";
import { INBOX_CHANGED_EVENT } from "@/lib/inbox-events";

export function InboxControls({ category, unread, pendingCount, canResolve }: {
  category: InboxCategory; unread: boolean; pendingCount: number; canResolve: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const categories: Array<[InboxCategory,string]> = [
    ["all","全部"],["replies","回复"],["likes","赞"],["system","系统"],
    ...(canResolve ? [["pending",`待处理 ${pendingCount}`] as [InboxCategory,string]] : []),
  ];
  return (
    <div id="inbox-controls" tabIndex={-1} aria-busy={pending}
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border py-3 focus-visible:outline-2 focus-visible:outline-primary">
      <nav aria-label="提醒分类" className={`flex max-w-full gap-1 overflow-x-auto ${pending ? "pointer-events-none opacity-60" : ""}`}>
        {categories.map(([value,label]) => <Link key={value} href={inboxHref(value,unread)} prefetch={false}
          aria-current={category === value ? "page" : undefined} aria-disabled={pending}
          className={`inline-flex min-h-10 shrink-0 items-center border-b-2 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${category === value ? "border-primary bg-primary/5 text-foreground" : "border-transparent text-muted hover:bg-primary/5"}`}
          onNavigate={(event) => { event.preventDefault(); if (!pending) startTransition(() => router.push(inboxHref(value,unread),{scroll:false})); }}>
          {label}
        </Link>)}
      </nav>
      <Label htmlFor="inbox-unread" className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
        <Checkbox id="inbox-unread" checked={unread} disabled={pending}
          onCheckedChange={(checked) => startTransition(() => router.push(inboxHref(category,checked === true),{scroll:false}))} />
        只看未读
      </Label>
    </div>
  );
}

export function InboxFeedback() {
  const [message,setMessage] = useState("");
  useEffect(() => {
    const receive = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (typeof detail === "string") setMessage(detail);
    };
    window.addEventListener(INBOX_CHANGED_EVENT,receive);
    return () => window.removeEventListener(INBOX_CHANGED_EVENT,receive);
  },[]);
  return <p role="status" className={message ? "py-2 text-sm text-muted" : "sr-only"}>{message}</p>;
}
