import { CommentSummaryList } from "@/app/components/profile/comment-summary-list";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { parseAccountPage } from "@/lib/server/auth/account-user";
import { searchUserComments } from "@/lib/server/db/work-community";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { requirePublicProfileSection } from "../public-user";
export const dynamic = "force-dynamic";
export default async function PublicComments({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ page?: string | string[] }> }) { const user = await requirePublicProfileSection((await params).userId, "comments"); const page = parseAccountPage((await searchParams).page); const result = await searchUserComments({ userId: user.id, publicOnly: true, page, pageSize: 20 }); const base = `/users/${user.id}/comments`; return <section><h2>公开评论</h2>{result.items.length ? <CommentSummaryList items={result.items}  /> : <AccountEmpty>还没有公开评论。</AccountEmpty>}<PaginationLinks basePath={base} page={page} pageSize={result.pageSize} total={result.total} /></section>; }
