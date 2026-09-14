import { redirect } from "next/navigation";
import { forumHref } from "@/lib/forum";

export default async function DiscussionSearchPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(forumHref("/search", { scope: "discussions", q: params.q, page: params.page }));
}
