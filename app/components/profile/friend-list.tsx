import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { FollowPage } from "@/lib/dto/db/user-follows";
import { Link } from "react-router";

export function FriendList({ users }: { users: FollowPage["items"] }) {
  return <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-3 gap-y-4 p-0">
    {users.map((user) => <li key={user.id} className="min-w-0">
      <Link to={`/users/${user.id}`} title={user.displayName} className="flex min-w-0 flex-col items-center gap-1.5 rounded-md text-center hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">
        <UserAvatar avatarBlobSha256={user.avatarBlobSha256} displayName={user.displayName} size={48} className="size-12" />
        <span className="w-full truncate text-xs">{user.displayName}</span>
      </Link>
    </li>)}
  </ul>;
}
