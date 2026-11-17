import { useMessages } from "@/lib/i18n/react";
import { AccountSection } from "@/app/components/profile/account-content";
import { FriendList } from "@/app/components/profile/friend-list";
import type { FollowPage } from "@/lib/dto/db/user-follows";
import type { ReactNode } from "react";

export function FriendSection({
  href,
  users,
  divided = true,
  status,
}: {
  href: string;
  users: FollowPage["items"];
  divided?: boolean;
  status?: ReactNode;
}) {
  const t = useMessages();
  return (
    <AccountSection href={href} title={t("friends.title")} divided={divided} status={status}>
      {users.length > 0 ? <FriendList users={users} /> : null}
    </AccountSection>
  );
}
