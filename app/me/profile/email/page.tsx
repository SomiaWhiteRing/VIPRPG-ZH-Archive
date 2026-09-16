import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  EmailInput,
  PasswordInput,
  VerificationCodeInput,
} from "@/app/components/auth/auth-input";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { requireAccountUser } from "@/app/.server/auth/account-user";
import { AccountField } from "@/app/components/profile/account-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const user = await requireAccountUser(runtime, "/me/profile/email");
  const params = await searchParams;

  return { user: pickPageFields(user, ["email"]), params };
}

export default function EmailPage() {
  const { user, params } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader title="修改登录邮箱" />
      {params.emailUpdated ? (
        <Notice
          tone="success"
          className="mb-4 rounded-md px-4 py-3 text-sm"
          role="status"
        >
          邮箱已更新，其他设备已登出。
        </Notice>
      ) : null}
      {params.emailSent ? (
        <Notice
          tone="success"
          className="mb-4 rounded-md px-4 py-3 text-sm"
          role="status"
        >
          验证码已发送到新邮箱。
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
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <p className="mb-5 text-sm text-muted">
            当前登录邮箱：
            <span className="font-semibold text-foreground">{user.email}</span>
          </p>
          {params.emailSent && params.newEmail ? (
            <form
              action="/api/account/email/confirm"
              className="grid gap-4"
              method="post"
            >
              <Input name="newEmail" type="hidden" value={params.newEmail} />
              <AccountField htmlFor="email-change-new" label="新邮箱">
                <Input disabled id="email-change-new" value={params.newEmail} />
              </AccountField>
              <AccountField htmlFor="email-change-code" label="验证码">
                <VerificationCodeInput
                  id="email-change-code"
                  name="code"
                  required
                />
              </AccountField>
              <div className="md:pl-[174px]">
                <Rm2kButton type="submit">确认修改邮箱</Rm2kButton>
              </div>
            </form>
          ) : (
            <form
              action="/api/account/email/start"
              className="grid gap-4"
              method="post"
            >
              <AccountField htmlFor="email-change-address" label="新邮箱">
                <EmailInput
                  defaultValue={params.newEmail}
                  id="email-change-address"
                  name="newEmail"
                  required
                />
              </AccountField>
              <AccountField htmlFor="email-change-password" label="当前密码">
                <PasswordInput
                  id="email-change-password"
                  name="currentPassword"
                  required
                />
              </AccountField>
              <div className="md:pl-[174px]">
                <Rm2kButton type="submit">发送验证码</Rm2kButton>
              </div>
            </form>
          )}
        </div>
        <aside className="border-t border-border pt-5 text-sm lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <h2 className="m-0 text-base font-bold">修改流程</h2>
          <ol className="mb-0 mt-3 grid gap-2 pl-5 text-muted">
            <li>填写新邮箱和当前密码</li>
            <li>查收新邮箱验证码</li>
            <li>确认修改</li>
          </ol>
          <p className="mb-0 mt-6 text-muted">确认完成前，当前邮箱保持不变。</p>
        </aside>
      </div>
    </div>
  );
}
