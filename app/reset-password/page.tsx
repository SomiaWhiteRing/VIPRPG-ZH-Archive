import { EmailInput, VerificationCodeInput, PasswordInput } from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";

import { Notice } from "@/app/components/ui/notice";
import { Button } from "@/app/components/ui/button";
import Link from "next/link";
import { FormField } from "@/app/components/ui/form-field";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { VERIFICATION_EMAIL_HINT } from "@/lib/labels";

export const dynamic = "force-dynamic";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    next?: string;
    email?: string;
    sent?: string;
    error?: string;
  }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next, "/login");

  return (
    <AuthPageShell title="重置密码" subtitle="输入邮箱验证码和新密码。" footer={<><Link href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>重新发送验证码</Link><Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link></>}>
          {params.sent ? (
            <Notice tone="success" className="mb-4 rounded-md border p-3">
              {VERIFICATION_EMAIL_HINT.replace("{email}", params.email ?? "")}
            </Notice>
          ) : null}
          {params.error ? (
            <Notice tone="error" className="mb-4 rounded-md border p-3">{params.error}</Notice>
          ) : null}
          <form action="/api/auth/password-reset/confirm" method="post" className="grid gap-4">
            <input type="hidden" name="next" value={nextPath} />
            <FormField controlId="reset-password-field-1" label="邮箱">
              <EmailInput id="reset-password-field-1" defaultValue={params.email ?? ""} name="email" placeholder="name@example.com" required />
            </FormField>
            <FormField controlId="reset-password-field-2" label="验证码">
              <VerificationCodeInput id="reset-password-field-2" name="code" required />
            </FormField>
            <FormField controlId="reset-password-field-3" label="新密码">
              <PasswordInput id="reset-password-field-3" purpose="new" name="password" required />
            </FormField>
            <Button type="submit">更新密码</Button>
          </form>
          
        </AuthPageShell>
  );
}
