import type { ReactNode } from "react";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { requirePublicUser } from "./public-user";
import { PublicProfileNavigation } from "./public-profile-navigation";

export default async function PublicUserLayout({ children, params }: { children: ReactNode; params: Promise<{ userId: string }> }) {
  const user = await requirePublicUser((await params).userId);
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-7 sm:px-6">
      <header className="flex items-start gap-4">
        <UserAvatar avatarBlobSha256={user.avatarBlobSha256} className="size-20" displayName={user.displayName} size={80} />
        <div className="min-w-0">
          <h1 className="m-0 truncate text-2xl font-extrabold">{user.displayName}</h1>
          {user.profileVisibility.bio ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{user.bio || "这位用户还没有填写简介。"}</p> : null}
        </div>
      </header>
      <PublicProfileNavigation userId={user.id} visibility={user.profileVisibility} />
      <div className="min-w-0">{children}</div>
    </main>
  );
}
