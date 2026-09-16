import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getD1 } from "@/app/.server/db/d1";
import { forumImageCleanupSql } from "@/app/.server/forum/image-storage";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { forumPage } from "@/lib/forum";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ImageCleanupButton } from "./cleanup-button";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  await requirePagePermission(
    runtime,
    "/admin/discussions/images",
    "forum.content.moderate_any",
  );
  const page = forumPage((await searchParams).page);
  const rows = await getD1(runtime)
    .prepare(
      `SELECT i.id,i.status,i.created_at,u.display_name AS author,p.topic_id,p.post_number FROM forum_images i JOIN users u ON u.id=i.user_id LEFT JOIN forum_posts p ON p.id=i.post_id WHERE i.status IN('ready','failed','cleanup','uncertain','uploading') AND ${forumImageCleanupSql} ORDER BY i.created_at DESC,i.id LIMIT 51 OFFSET ?`,
    )
    .bind((page - 1) * 50)
    .all<{
      id: string;
      status: string;
      created_at: string;
      author: string;
      topic_id: number | null;
      post_number: number | null;
    }>();

  return { page, rows };
}

export default function ForumImageCleanup() {
  const { page, rows } = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto grid w-[min(1180px,calc(100%-2rem))] gap-4 py-6">
      <PageHeader title="讨论图片清理" />
      <Link to="/admin/discussions" className="text-sm text-primary">
        返回讨论管理
      </Link>
      <p className="text-sm text-muted">
        仅清理未关联图片，或所属帖子、主题已隐藏或删除的图片。仅账户停用不满足清理条件。
      </p>
      <ul className="divide-y divide-border">
        {rows.results.slice(0, 50).map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0 text-sm">
              <p>
                {row.author} · {row.created_at}
              </p>
              <p className="break-all font-mono text-xs text-muted">{row.id}</p>
              {row.topic_id ? (
                <p>
                  主题 {row.topic_id} · #{row.post_number}
                </p>
              ) : (
                <p>未关联帖子</p>
              )}
            </div>
            {row.status === "uploading" || row.status === "uncertain" ? (
              <form action="/api/admin/discussions/images" method="post">
                <Input type="hidden" name="id" value={row.id} />
                <Input type="hidden" name="op" value="reconcile" />
                <Button type="submit" variant="outline">
                  核对上传状态
                </Button>
              </form>
            ) : (
              <ImageCleanupButton
                id={row.id}
                author={row.author}
                topicId={row.topic_id}
                postNumber={row.post_number}
                retry={row.status === "cleanup"}
              />
            )}
          </li>
        ))}
      </ul>
      {!rows.results.length ? <EmptyState title="暂无待清理图片。" /> : null}
      <nav
        className="flex gap-4 text-sm text-primary"
        aria-label="图片清理分页"
      >
        {page > 1 ? <Link to={`?page=${page - 1}`}>上一页</Link> : null}
        {rows.results.length > 50 ? (
          <Link to={`?page=${page + 1}`}>下一页</Link>
        ) : null}
      </nav>
    </main>
  );
}
