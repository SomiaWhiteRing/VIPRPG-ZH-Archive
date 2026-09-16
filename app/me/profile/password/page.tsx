import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PasswordInput } from "@/app/components/auth/auth-input";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { requireAccountUser } from "@/app/.server/auth/account-user";
import { AccountField } from "@/app/components/profile/account-field";
import { Notice } from "@/app/components/ui/notice";
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  await requireAccountUser(runtime, "/me/profile/password");
  const params = await searchParams;

  return { params };
}

export default function PasswordPage() {
  const { params } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader title="修改密码" />
      {params.passwordUpdated ? (
        <Notice
          tone="success"
          className="mb-4 rounded-md px-4 py-3 text-sm"
          role="status"
        >
          密码已更新，其他设备已登出。
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
      <form action="/api/account/password" className="grid gap-4" method="post">
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
        <p className="m-0 text-xs text-muted md:pl-[174px]">
          新密码长度为 12 至 256 个字符。
        </p>
        <div className="md:pl-[174px]">
          <Rm2kButton type="submit">修改密码</Rm2kButton>
        </div>
      </form>
    </div>
  );
}
