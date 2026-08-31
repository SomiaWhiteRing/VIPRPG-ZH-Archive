import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { Badge } from "@/app/components/ui/badge";
import { requireAccountUser } from "@/lib/server/auth/account-user";
import { searchUploadedWorks, searchUserWorks } from "@/lib/server/db/game-library";
import { searchCatalogsForOwner } from "@/lib/server/db/catalogs";
import { searchUserComments } from "@/lib/server/db/work-community";
import { canUpload } from "@/lib/server/db/users";
import { formatDate } from "@/lib/format";
import { AccountEmpty, AccountSection, AccountWorkGrid } from "./account-content";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const user = await requireAccountUser("/me");
  const showUploads = canUpload(user);
  const [played, favorites, catalogs, comments, uploads] = await Promise.all([
    searchUserWorks({ userId: user.id, kind: "played", pageSize: 4 }),
    searchUserWorks({ userId: user.id, kind: "favorite", pageSize: 4 }),
    searchCatalogsForOwner({ userId: user.id, pageSize: 3 }),
    searchUserComments({ userId: user.id, pageSize: 3 }),
    showUploads ? searchUploadedWorks({ userId: user.id, pageSize: 3 }) : Promise.resolve(null),
  ]);

  return (
    <div className="grid gap-7">
      <PageHeader title="个人中心" subtitle="从这里继续最近的游戏、收藏和内容维护。" />
      <AccountSection
        href="/me/profile"
        status={!user.profileVisibility.bio ? <Badge variant="outline">简介未在个人主页展示</Badge> : undefined}
        title="资料摘要"
      >
        <div className="flex items-center gap-4">
          <UserAvatar avatarBlobSha256={user.avatarBlobSha256} className="size-16" displayName={user.displayName} size={64} />
          <div className="min-w-0"><strong className="block truncate text-lg">{user.displayName}</strong><p className="mt-1 line-clamp-2 text-sm text-muted">{user.bio || "还没有填写简介。"}</p></div>
        </div>
      </AccountSection>
      <AccountSection
        href="/me/history"
        status={!user.profileVisibility.history ? <Badge variant="outline">未在个人主页展示</Badge> : undefined}
        title="最近游玩"
      >{played.items.length ? <AccountWorkGrid items={played.items} /> : <AccountEmpty><Link href="/games">前往游戏库</Link>开始游玩。</AccountEmpty>}</AccountSection>
      <AccountSection
        href="/me/favorites"
        status={!user.profileVisibility.favorites ? <Badge variant="outline">未在个人主页展示</Badge> : undefined}
        title="最近收藏"
      >{favorites.items.length ? <AccountWorkGrid items={favorites.items} /> : <AccountEmpty><Link href="/games">前往游戏库</Link>收藏感兴趣的作品。</AccountEmpty>}</AccountSection>
      <AccountSection
        href="/me/catalogs"
        status={!user.profileVisibility.catalogs ? <Badge variant="outline">未在个人主页展示</Badge> : undefined}
        title="我的目录"
      >
        {catalogs.items.length ? <ul className="divide-y divide-border border-y border-border">{catalogs.items.map((catalog, index) => <li className={`py-3 ${index >= 2 ? "hidden sm:block" : ""}`} key={catalog.id}><Link className="font-semibold" href={`/catalogs/${catalog.id}`}>{catalog.title}</Link><p className="mt-1 text-sm text-muted">{catalog.itemCount} 部作品 · 更新于 {formatDate(catalog.updatedAt)}</p></li>)}</ul> : <AccountEmpty>创建目录，把作品整理成便于分享的清单。</AccountEmpty>}
      </AccountSection>
      <AccountSection
        href="/me/comments"
        status={!user.profileVisibility.comments ? <Badge variant="outline">未在个人主页展示</Badge> : undefined}
        title="我的评论"
      >
        {comments.items.length ? <ul className="divide-y divide-border border-y border-border">{comments.items.map((comment, index) => <li className={`py-3 ${index >= 2 ? "hidden sm:block" : ""}`} key={comment.id}><Link className="font-semibold" href={`/games/${comment.workId}#comment-${comment.id}`}>{comment.workTitle}</Link><p className="mt-1 line-clamp-2 text-sm text-muted">{comment.body || "这条评论已删除。"}</p></li>)}</ul> : <AccountEmpty>浏览作品并留下第一条评论。</AccountEmpty>}
      </AccountSection>
      {uploads ? <AccountSection href="/me/uploads" title="最近上传">{uploads.items.length ? <ul className="divide-y divide-border border-y border-border">{uploads.items.map((work, index) => <li className={`flex items-center justify-between gap-3 py-3 ${index >= 2 ? "hidden sm:flex" : ""}`} key={work.id}><div className="min-w-0"><Link className="block truncate font-semibold" href={`/me/uploads/${work.id}`}>{work.chineseTitle || work.originalTitle}</Link><span className="text-sm text-muted">{work.distribution === "archive" ? "本站归档" : "外部下载"}</span></div><StatusBadge kind="publication" value={work.status} /></li>)}</ul> : <AccountEmpty><Link href="/upload">开始上传</Link>第一部作品。</AccountEmpty>}</AccountSection> : null}
    </div>
  );
}
