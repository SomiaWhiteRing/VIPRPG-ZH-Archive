import { EmailInput } from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";

import { Notice } from "@/app/components/ui/notice";
import { Button } from "@/app/components/ui/button";
import Link from "next/link";
import { FormField } from "@/app/components/ui/form-field";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";

export const dynamic = "force-dynamic";

type ForgotPasswordPageProps = {
  searchParams: Promise<{
    next?: string;
    email?: string;
    error?: string;
  }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next, "/login");

  return (
    <AuthPageShell title="找回密码" subtitle="通过邮箱验证码设置新密码。" footer={<><Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link></>}>
      {params.error ? (
        <Notice tone="error" className="mb-4 rounded-md border p-3">{params.error}</Notice>
      ) : null}
      <form action="/api/auth/password-reset/start" method="post" className="grid gap-4">
        <input type="hidden" name="next" value={nextPath} />
        <FormField controlId="forgot-password-field-1" label="邮箱">
          <EmailInput id="forgot-password-field-1" defaultValue={params.email ?? ""} name="email" placeholder="name@example.com" required />
        </FormField>
        <Button type="submit">发送验证码</Button>
      </form>

    </AuthPageShell>
  );
}
