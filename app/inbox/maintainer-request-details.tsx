import { Link } from 'react-router';
import { UserAvatar } from '@/app/components/ui/user-avatar';
import { Badge } from '@/app/components/ui/badge';
import type { InboxItem } from '@/lib/dto/db/inbox';

export function MaintainerRequestDetails({ request }: { request: NonNullable<InboxItem['maintainerRequest']> }) {
  const labels = { pending: '待审核', approved: '已通过', rejected: '已驳回', withdrawn: '已撤回', closed: '已关闭' };
  return <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 wrap-anywhere text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <Link className="flex min-w-0 items-center gap-2 text-primary hover:underline" to={`/users/${request.applicant.id}`}>
        <UserAvatar displayName={request.applicant.displayName} avatarBlobSha256={request.applicant.avatarBlobSha256} size={28} className="size-7 shrink-0" />
        <span className="min-w-0 wrap-anywhere">{request.applicant.displayName}</span>
      </Link>
      <Badge variant="outline">{labels[request.status]}</Badge>
    </div>
    <Link className="text-primary hover:underline" to={`/games/${request.workId}`}>{request.workTitle}</Link>
  </div>;
}
