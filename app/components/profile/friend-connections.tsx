import { useMessages } from "@/lib/i18n/react";
import { FriendList } from "@/app/components/profile/friend-list";
import { Button } from "@/app/components/ui/button";
import type { FollowDirection, FollowPage } from "@/lib/dto/db/user-follows";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

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
  const t = useMessages();
  return <section aria-label={t("friends.relations")} className="grid gap-5">
    <nav aria-label={t("friends.scope")} className="flex flex-wrap gap-2">
      {(["following", "followers"] as const).map((value) => <Button asChild size="sm" variant={view === value ? "default" : "ghost"} key={value}><Link to={`${basePath}?view=${value}`} aria-current={view === value ? "page" : undefined}>{value === "following" ? (isSelf ? t("friends.mine") : t("friends.their", { name: displayName })) : (isSelf ? t("friends.addedMe") : t("friends.addedThem", { name: displayName }))}</Link></Button>)}
    </nav>
    <FriendList users={page.items} />
    {(hasCursor || page.nextCursor) && <nav aria-label={t("friends.pages")} className="flex flex-wrap justify-between gap-3">
      {hasCursor ? <Button asChild variant="outline"><Link to={`${basePath}?view=${view}`}>{t("timeline.feed.latest")}</Link></Button> : <span />}
      {page.nextCursor && <Button asChild variant="outline"><Link to={`${basePath}?view=${view}&cursor=${encodeURIComponent(page.nextCursor)}`} prefetch="none">{t("friends.more")}</Link></Button>}
    </nav>}
  </section>;
}
