import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { requireAccountUser } from "@/app/.server/auth/account-user";
import { AvatarCropper } from "@/app/components/ui/avatar-cropper";
import { Button } from "@/app/components/ui/button";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { Textarea } from "@/app/components/ui/textarea";
import { Link } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const user = await requireAccountUser(runtime, "/me/profile");
  const params = await searchParams;

  return {
    user: pickPageFields(user, [
      "displayName",
      "bio",
      "avatarBlobSha256",
      "email",
      "isBootstrapAdmin",
    ]),
    params,
  };
}

export default function ProfilePage() {
  const { user, params } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader title="个人资料" />
      {params.profileUpdated ? (
        <Notice
          tone="success"
          className="mb-4 rounded-md px-4 py-3 text-sm"
          role="status"
        >
          个人资料已更新。
        </Notice>
      ) : null}
      {params.error ? (
        <Notice
          tone="error"
          className="mb-4 rounded-md px-4 py-3 text-sm"
          role="alert"
        >
          {params.error}
        </Notice>
      ) : null}
      <form action="/api/account/profile" method="post">
        <div className="divide-y divide-border border-y border-border">
          <div className="grid gap-2 py-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-center">
            <Label htmlFor="profile-display-name">显示名</Label>
            <Input
              defaultValue={user.displayName}
              id="profile-display-name"
              maxLength={80}
              name="displayName"
              required
            />
          </div>
          <div className="grid gap-2 py-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-start">
            <Label className="pt-2" htmlFor="profile-bio">
              简介
            </Label>
            <div>
              <Textarea
                defaultValue={user.bio}
                id="profile-bio"
                maxLength={500}
                name="bio"
                rows={5}
              />
              <p className="mb-0 mt-1 text-xs text-muted">
                纯文本，最多 500 个字符。
              </p>
            </div>
          </div>
          <div className="grid gap-2 py-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-start">
            <span className="text-sm font-semibold">头像</span>
            <AvatarCropper
              avatarBlobSha256={user.avatarBlobSha256}
              displayName={user.displayName}
            />
          </div>
          <div className="grid gap-2 py-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-center">
            <span className="text-sm font-semibold">账号安全</span>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <span className="min-w-0 break-all text-sm">
                邮箱：{user.email}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-4 text-sm font-semibold">
                <Link
                  className="text-primary hover:underline"
                  to="/me/profile/email"
                >
                  修改邮箱
                </Link>
                <Link
                  className="text-primary hover:underline"
                  to="/me/profile/password"
                >
                  修改密码
                </Link>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-5">
          <Rm2kButton type="submit">保存资料</Rm2kButton>
        </div>
      </form>
      {!user.isBootstrapAdmin ? (
        <section className="mt-8 border-t border-border pt-5">
          <h2 className="text-lg font-semibold">注销账户</h2>
          <ConfirmingForm
            action="/api/account/delete"
            confirmField="confirm"
            title="确认注销账户？"
            description="注销后无法登录，名称改为“账户已注销”，头像恢复默认，个人主页内容全部设为不可见。已上传作品、评论和其他公共贡献会保留。此操作无法撤销。"
          >
            <input name="confirm" type="hidden" value="delete" />
            <Label htmlFor="delete-account-password">当前密码</Label>
            <Input
              autoComplete="current-password"
              id="delete-account-password"
              name="password"
              type="password"
              required
            />
            <Button className="mt-3" type="submit" variant="destructive">
              注销账户
            </Button>
          </ConfirmingForm>
        </section>
      ) : null}
    </div>
  );
}
