
import { Notice } from "@/app/components/ui/notice";
import { PageContainer } from "@/app/components/ui/page-container";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import Link from "next/link";
import { FormField } from "@/app/components/ui/form-field";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
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
    <PageContainer>
      <PageHeader compact title="找回密码" subtitle="通过邮箱验证码设置新密码。" />
      <div className="mx-auto mt-5 max-w-md">
        <Pane>
          {params.error ? (
            <Notice tone="error" className="mb-4 rounded-md border p-3">{params.error}</Notice>
          ) : null}
          <form action="/api/auth/password-reset/start" method="post" className="grid gap-4">
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
            <Button type="submit">发送验证码</Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-primary">
            <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link>
          </div>
        </Pane>
      </div>
    </PageContainer>
  );
}
