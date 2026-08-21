import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import {
  canAccessSuperAdminRole,
  canManageUsersRole,
} from "@/lib/server/auth/roles";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { roleLabel } from "@/lib/labels";
import { SiteHeaderNav } from "./site-header-nav";

export async function SiteHeader() {
  const currentUser = await getCurrentUserFromCookies();
  const unread = currentUser
    ? await countUnreadInboxItemsForUser(currentUser)
    : 0;

  const canAdmin = currentUser ? canManageUsersRole(currentUser.role) : false;
  const canSuper = currentUser ? canAccessSuperAdminRole(currentUser.role) : false;

  return (
    <SiteHeaderNav
      session={
        currentUser
          ? {
              displayName: currentUser.displayName,
              roleLabel: roleLabel(currentUser.role),
              canAdmin,
              canSuper,
              unread,
            }
          : null
      }
      logout={
        currentUser ? (
          <form action="/api/auth/logout" method="post" className="inline-form">
            <input type="hidden" name="next" value="/" />
            <button className="button" type="submit">
              退出
            </button>
          </form>
        ) : null
      }
      loginLink={
        !currentUser ? (
          <Link className="button primary" href="/login">
            登录
          </Link>
        ) : null
      }
    />
  );
}
