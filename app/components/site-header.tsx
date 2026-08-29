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
      loginLink={
        !currentUser ? (
          <Link
            className="inline-flex min-h-8 items-center justify-center rounded-md border-2 border-white bg-linear-to-b from-rm2k-green-1 via-[#3f6c4e] to-rm2k-green-2 px-3 py-1.5 text-xs font-semibold text-white shadow-[3px_3px_0_rgb(23_33_43/30%),inset_0_0_0_2px_rgb(0_0_0/20%)] hover:brightness-110"
            href="/login"
          >
            登录
          </Link>
        ) : null
      }
    />
  );
}
