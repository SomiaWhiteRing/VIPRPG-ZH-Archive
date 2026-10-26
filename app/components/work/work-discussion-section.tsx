import { useState } from "react";
import { Link, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { CommentPanel } from "@/app/components/comments/comment-panel";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { CommentPage, WorkCollection } from "@/lib/dto/db/work-community";
import { formatDate, formatExactTimestamp, formatNumber, parseTimestamp } from "@/lib/format";
import { requestJson } from "@/lib/ui/api-response";

type WorkCollections = { items: WorkCollection[]; total: number; page: number; pageSize: number };

export function useWorkCollections(workId: number, initialCollections: WorkCollections) {
  const [snapshot, setSnapshot] = useState({ source: initialCollections, collections: initialCollections });
  const collections = snapshot.source === initialCollections ? snapshot.collections : initialCollections;
  async function refreshCollections() {
    const result = await requestJson<{ ok: true; collections: WorkCollections }>(
      `/api/works/${workId}/collections?notes=1&page=${collections.page}`, {}, "吐槽列表加载失败",
    );
    setSnapshot({ source: initialCollections, collections: result.collections });
  }
  return { collections, refreshCollections };
}

export function WorkDiscussionSection({ workId, currentUserId, canPin, commentCount, comments, collections }: {
  workId: number;
  currentUserId: number | null;
  canPin: boolean;
  commentCount: number;
  comments: CommentPage;
  collections: WorkCollections;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const activeTab = searchParams.get("tab") === "collections" ? "collections" : "comments";
  return (
    <section
      aria-labelledby="comments-title"
      className="scroll-mt-28 border-t border-border py-4.5"
      id="sec-comments"
    >
      <Tabs value={activeTab} onValueChange={(value) => {
        setSearchParams((params) => {
          params.set("tab", value);
          return params;
        }, { preventScrollReset: true });
      }}>
        <TabsList aria-label="作品评论与吐槽" id="comments-title">
          <TabsTrigger value="comments">评论（{formatNumber(commentCount)}）</TabsTrigger>
          <TabsTrigger value="collections">吐槽（{formatNumber(collections.total)}）</TabsTrigger>
        </TabsList>
        <TabsContent value="comments" forceMount className="data-[state=inactive]:hidden">
          <CommentPanel
            onChanged={() => { void revalidator.revalidate(); }}
            currentUserId={currentUserId}
            canPin={canPin}
            initialComments={comments.items}
            initialNextCursor={comments.nextCursor}
            target={{ kind: "work", id: workId }}
          />
        </TabsContent>
        <TabsContent value="collections">
          {collections.items.length ? (
            <ul className="grid gap-7">
              {collections.items.map((entry) => (
                <li className="flex min-w-0 items-start gap-3.5" key={entry.userId}>
                  <Link className="shrink-0" to={`/users/${entry.userId}`}>
                    <UserAvatar avatarBlobSha256={entry.avatarBlobSha256} displayName={entry.displayName} size={48} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="border-b border-border pb-1">
                      <Link className="wrap-anywhere text-sm font-bold text-foreground hover:text-primary hover:underline" to={`/users/${entry.userId}`}>
                        {entry.displayName}
                      </Link>
                    </div>
                    <time className="mt-1 block text-xs text-muted" dateTime={parseTimestamp(entry.favoritedAt).toISOString()} title={formatExactTimestamp(entry.favoritedAt)}>
                      {formatDate(entry.favoritedAt)}
                    </time>
                    {entry.note ? <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-black dark:text-foreground">{entry.note}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="暂无吐槽。" />}
          <PaginationLinks page={collections.page} pageSize={collections.pageSize} total={collections.total}
            onPageChange={(page) => {
              const params = new URLSearchParams(searchParams);
              params.set("tab", "collections");
              params.set("page", String(page));
              void navigate(`?${params}#sec-comments`, { preventScrollReset: true });
            }} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
