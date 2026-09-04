import Link from "next/link";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { parseAccountPage } from "@/lib/server/auth/account-user";
import { searchUserComments } from "@/lib/server/db/work-community";
import { formatDate } from "@/lib/format";
import { AccountEmpty } from "@/app/me/account-content";
import { requirePublicProfileSection } from "../public-user";
export const dynamic = "force-dynamic";
export default async function PublicComments({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ page?: string | string[] }> }) { const user = await requirePublicProfileSection((await params).userId, "comments"); const page = parseAccountPage((await searchParams).page); const result = await searchUserComments({ userId: user.id, publicOnly: true, page, pageSize: 20 }); const base = `/users/${user.id}/comments`; return <section><h2>公开评论</h2>{result.items.length ? <ul className="divide-y divide-border border-y border-border">{result.items.map((comment) => <li className="grid gap-2 py-4" key={comment.id}><Link className="font-semibold" href={`/games/${comment.workId}#comment-${comment.id}`}>{comment.workTitle}</Link><p className="m-0 whitespace-pre-wrap text-sm">{comment.body}</p><span className="text-xs text-muted">{formatDate(comment.updatedAt)} · {comment.likeCount} 个赞</span></li>)}</ul> : <AccountEmpty>还没有公开评论。</AccountEmpty>}<PaginationLinks basePath={base} page={page} pageSize={result.pageSize} total={result.total} /></section>; }
