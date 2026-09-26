import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { requireAccountUser } from "@/app/.server/auth/account-user";
import { AvatarCropper } from "@/app/components/ui/avatar-cropper";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { Textarea } from "@/app/components/ui/textarea";
import { Link } from "react-router";
import { RedirectForm } from "@/app/components/ui/redirect-form";

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

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["个人资料", "个人中心"] }, error);

export default function ProfilePage() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader title="个人资料" />
      <RedirectFeedback success={{ profileUpdated: "个人资料已更新。" }} />

      <RedirectForm action="/api/account/profile" method="post">
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
            </div>
          </div>
          <div className="grid gap-2 py-4 md:grid-cols-[120px_minmax(0,1fr)] md:items-start">
            <span className="text-sm font-semibold">头像</span>
            <AvatarCropper
              alignActions="end"
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
              <div className="ml-auto flex flex-wrap items-center justify-end gap-4 text-sm font-semibold">
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
                {!user.isBootstrapAdmin ? (
                  <Link
                    className="text-destructive hover:underline"
                    to="/me/profile/delete"
                  >
                    注销账号
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Rm2kButton type="submit">保存资料</Rm2kButton>
        </div>
      </RedirectForm>
    </div>
  );
}
