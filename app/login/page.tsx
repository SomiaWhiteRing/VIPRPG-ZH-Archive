import { EmailInput, PasswordInput } from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";

import { Notice } from "@/app/components/ui/notice";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormField } from "@/app/components/ui/form-field";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
    email?: string;
    error?: string;
    reset?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next);
  const currentUser = await getCurrentUserFromCookies();

  if (currentUser) {
    redirect(nextPath);
  }

  return (
    <AuthPageShell title="登录" subtitle="使用邮箱和密码进入账户。" footer={<><Link href={`/register?next=${encodeURIComponent(nextPath)}`}>注册账户</Link><Link href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>找回密码</Link></>}>
      {params.reset ? (
        <Notice tone="success" className="mb-4 rounded-md border p-3">
          密码已更新，请重新登录。
        </Notice>
      ) : null}
      {params.error ? (
        <Notice tone="error" className="mb-4 rounded-md border p-3">{params.error}</Notice>
      ) : null}
      <form action="/api/auth/login" method="post" className="grid gap-4">
        <input type="hidden" name="next" value={nextPath} />
        <FormField controlId="login-field-1" label="邮箱">
          <EmailInput id="login-field-1" defaultValue={params.email ?? ""} name="email" placeholder="name@example.com" required />
        </FormField>
        <FormField controlId="login-field-2" label="密码">
          <PasswordInput id="login-field-2" name="password" required />
        </FormField>
        <Rm2kButton type="submit">登录</Rm2kButton>
      </form>

    </AuthPageShell>
  );
}
