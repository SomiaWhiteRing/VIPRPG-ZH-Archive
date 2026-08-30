import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { requireAccountUser } from "@/lib/server/auth/account-user";
import { AvatarCropper } from "./avatar-cropper";

export const dynamic = "force-dynamic";

type Params = {
  profileUpdated?: string;
  error?: string;
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireAccountUser("/me/profile");
  const params = await searchParams;

  return (
    <div>
      <PageHeader title="个人资料" />
      {params.profileUpdated ? <p className="mb-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">个人资料已更新。</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">{params.error}</p> : null}
      <form action="/api/account/profile" method="post">
        <div className="divide-y divide-border border-y border-border">
          <div className="grid gap-2 py-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-center">
            <Label htmlFor="profile-display-name">显示名</Label>
            <Input defaultValue={user.displayName} id="profile-display-name" maxLength={80} name="displayName" required />
          </div>
          <div className="grid gap-2 py-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-start">
            <Label className="pt-2" htmlFor="profile-bio">简介</Label>
            <div>
              <Textarea defaultValue={user.bio} id="profile-bio" maxLength={500} name="bio" rows={5} />
              <p className="mb-0 mt-1 text-xs text-muted">纯文本，最多 500 个字符。</p>
            </div>
          </div>
          <div className="grid gap-2 py-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-start">
            <span className="text-sm font-semibold">头像</span>
            <AvatarCropper avatarBlobSha256={user.avatarBlobSha256} displayName={user.displayName} />
          </div>
          <div className="grid gap-2 py-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-center">
            <span className="text-sm font-semibold">账号安全</span>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <span className="min-w-0 break-all text-sm">邮箱：{user.email}</span>
              <div className="ml-auto flex shrink-0 items-center gap-4 text-sm font-semibold">
                <Link className="text-primary hover:underline" href="/me/profile/email">修改邮箱</Link>
                <Link className="text-primary hover:underline" href="/me/profile/password">修改密码</Link>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-5"><Rm2kButton type="submit">保存资料</Rm2kButton></div>
      </form>
    </div>
  );
}
