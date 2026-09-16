import { EmailInput, PasswordInput, VerificationCodeInput } from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";

import { Notice } from "@/app/components/ui/notice";
import { Button } from "@/app/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormField } from "@/app/components/ui/form-field";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { VERIFICATION_EMAIL_HINT } from "@/lib/labels";

export const dynamic = "force-dynamic";

type RegisterPageProps = {
  searchParams: Promise<{
    next?: string;
    email?: string;
    sent?: string;
    error?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next);
  const currentUser = await getCurrentUserFromCookies();

  if (currentUser) {
    redirect(nextPath);
  }

  return (
    <AuthPageShell title="注册" subtitle="注册后需要管理员批准才可以上传游戏。" footer={<><Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link></>}>
          {params.error ? (
            <Notice tone="error" className="mb-4 rounded-md border p-3">{params.error}</Notice>
          ) : null}
          {params.sent ? (
            <VerificationForm email={params.email ?? ""} nextPath={nextPath} />
          ) : (
            <RegisterStartForm nextPath={nextPath} />
          )}
          
        </AuthPageShell>
  );
}

function RegisterStartForm({ nextPath }: { nextPath: string }) {
  return (
    <form action="/api/auth/register/start" method="post" className="grid gap-4">
      <input type="hidden" name="next" value={nextPath} />
      <FormField controlId="register-field-1" label="邮箱">
        <EmailInput id="register-field-1" name="email" placeholder="name@example.com" required />
      </FormField>
      <FormField controlId="register-field-2" label="密码">
        <PasswordInput id="register-field-2" purpose="new" name="password" required />
      </FormField>
      <Button type="submit">发送验证码</Button>
    </form>
  );
}

function VerificationForm({ email, nextPath }: { email: string; nextPath: string }) {
  return (
    <form action="/api/auth/register/verify" method="post" className="grid gap-4">
      <Notice tone="success" className="mb-4 rounded-md border p-3">
        {VERIFICATION_EMAIL_HINT.replace("{email}", email)}
      </Notice>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="email" value={email} />
      <FormField controlId="register-field-3" label="验证码">
        <VerificationCodeInput id="register-field-3" name="code" required />
      </FormField>
      <Button type="submit">完成注册</Button>
    </form>
  );
}
