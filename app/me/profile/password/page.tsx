import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PasswordInput } from "@/app/components/auth/auth-input";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { requireAccountUser } from "@/app/.server/auth/account-user";
import { AccountField } from "@/app/components/profile/account-field";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { RedirectForm } from "@/app/components/ui/redirect-form";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  await requireAccountUser(runtime, "/me/profile/password");
  const params = await searchParams;

  return { params };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["修改密码", "个人中心"] }, error);

export default function PasswordPage() {
  return (
    <div>
      <PageHeader title="修改密码" />
      <RedirectFeedback success={{ passwordUpdated: "密码已更新，其他设备已登出。" }} />

      <RedirectForm action="/api/account/password" className="grid gap-4" method="post">
        <AccountField htmlFor="password-current" label="当前密码">
          <PasswordInput
            id="password-current"
            name="currentPassword"
            required
          />
        </AccountField>
        <AccountField htmlFor="password-new" label="新密码">
          <PasswordInput
            purpose="new"
            id="password-new"
            name="newPassword"
            required
          />
        </AccountField>
        <AccountField htmlFor="password-confirm" label="再次输入新密码">
          <PasswordInput
            purpose="new"
            id="password-confirm"
            name="confirmPassword"
            required
          />
        </AccountField>
        <div className="flex justify-end">
          <Rm2kButton type="submit">修改密码</Rm2kButton>
        </div>
      </RedirectForm>
    </div>
  );
}
