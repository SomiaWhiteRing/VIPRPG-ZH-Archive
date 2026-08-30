import type { ReactNode } from "react";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canUpload } from "@/lib/server/db/users";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { AccountNavigation } from "./account-navigation";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUserFromCookies();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="md:grid md:grid-cols-[232px_minmax(0,1fr)] md:gap-8">
        <div className="hidden md:block">
          {user ? (
            <div className="mb-5 flex min-w-0 items-center gap-3 px-2">
              <UserAvatar avatarBlobSha256={user.avatarBlobSha256} displayName={user.displayName} />
              <div className="min-w-0">
                <strong className="block truncate">{user.displayName}</strong>
                <span className="block truncate text-xs text-muted">{user.email}</span>
              </div>
            </div>
          ) : null}
          <AccountNavigation canUpload={Boolean(user && canUpload(user))} />
        </div>
        <div className="md:hidden">
          <AccountNavigation canUpload={Boolean(user && canUpload(user))} />
        </div>
        <div className="min-w-0 pt-5 md:pt-0">{children}</div>
      </div>
    </main>
  );
}
