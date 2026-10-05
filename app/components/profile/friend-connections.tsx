import { FriendList } from "@/app/components/profile/friend-list";
import { Button } from "@/app/components/ui/button";
import type { FollowDirection, FollowPage } from "@/lib/dto/db/user-follows";
import { Link } from "react-router";

export function FriendConnections({
  basePath,
  displayName,
  isSelf,
  view,
  page,
  hasCursor,
}: {
  basePath: string;
  displayName: string;
  isSelf: boolean;
  view: FollowDirection;
  page: FollowPage;
  hasCursor: boolean;
}) {
  return <section aria-label="好友关系" className="grid gap-5">
    <nav aria-label="好友列表范围" className="flex flex-wrap gap-2">
      {(["following", "followers"] as const).map((value) => <Button asChild size="sm" variant={view === value ? "default" : "ghost"} key={value}><Link to={`${basePath}?view=${value}`} aria-current={view === value ? "page" : undefined}>{value === "following" ? (isSelf ? "我的好友" : `${displayName}的好友`) : (isSelf ? "谁加我为好友" : `谁加${displayName}为好友`)}</Link></Button>)}
    </nav>
    <FriendList users={page.items} />
    {(hasCursor || page.nextCursor) && <nav aria-label="好友列表分页" className="flex flex-wrap justify-between gap-3">
      {hasCursor ? <Button asChild variant="outline"><Link to={`${basePath}?view=${view}`}>返回最新</Link></Button> : <span />}
      {page.nextCursor && <Button asChild variant="outline"><Link to={`${basePath}?view=${view}&cursor=${encodeURIComponent(page.nextCursor)}`} prefetch="none">更多用户</Link></Button>}
    </nav>}
  </section>;
}
