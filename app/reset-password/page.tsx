
import { Notice } from "@/app/components/ui/notice";
import { PageContainer } from "@/app/components/ui/page-container";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import Link from "next/link";
import { FormField } from "@/app/components/ui/form-field";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
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
    <PageContainer>
      <PageHeader compact title="重置密码" subtitle="输入邮箱验证码和新密码。" />
      <div className="mx-auto mt-5 max-w-md">
        <Pane>
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
            <FormField label="邮箱">
              <Input
                autoComplete="email"
                defaultValue={params.email ?? ""}
                inputMode="email"
                name="email"
                placeholder="name@example.com"
                required
                type="email"
              />
            </FormField>
            <FormField label="验证码">
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                minLength={6}
                name="code"
                pattern="[0-9]{6}"
                required
                type="text"
              />
            </FormField>
            <FormField label="新密码">
              <Input autoComplete="new-password" minLength={10} name="password" required type="password" />
            </FormField>
            <Button type="submit">更新密码</Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-primary">
            <Link href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>重新发送验证码</Link>
            <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link>
          </div>
        </Pane>
      </div>
    </PageContainer>
  );
}
