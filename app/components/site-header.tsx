import { Button } from "@/app/components/ui/button";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { SiteHeaderNav } from "./site-header-nav";

export async function SiteHeader() {
  const currentUser = await getCurrentUserFromCookies();
  const unread = currentUser ? await countUnreadInboxItemsForUser(currentUser) : 0;

  return (
    <SiteHeaderNav
      session={
        currentUser
          ? {
              displayName: currentUser.displayName,
              unread,
              permissionKeys: currentUser.permissionKeys,
              isBootstrapAdmin: currentUser.isBootstrapAdmin,
            }
          : null
      }
      logout={
        currentUser ? (
          <form action="/api/auth/logout" method="post" className="inline-form">
            <input type="hidden" name="next" value="/" />
            <Button
              className="inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold text-foreground hover:bg-muted/15"
              type="submit"
            >
              退出
            </Button>
          </form>
        ) : null
      }
      loginLink={
        !currentUser ? (
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-md border-2 border-white bg-gradient-to-b from-rm2k-green-1 via-[#3f6c4e] to-rm2k-green-2 px-3 text-sm font-semibold text-white shadow-[3px_3px_0_rgb(23_33_43_/_30%),inset_0_0_0_2px_rgb(0_0_0_/_20%)] hover:brightness-110"
            href="/login"
          >
            登录
          </Link>
        ) : null
      }
    />
  );
}
