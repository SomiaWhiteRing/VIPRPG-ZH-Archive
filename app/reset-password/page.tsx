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
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-12 mx-auto w-full max-w-md">
      <PageHeader eyebrow="Account" title="重置密码" subtitle="输入邮箱验证码和新密码。" />

      <Pane>
        {params.sent ? (
          <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-800">
            {VERIFICATION_EMAIL_HINT.replace("{email}", params.email ?? "")}
          </p>
        ) : null}
        {params.error ? (
          <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{params.error}</p>
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
    </main>
  );
}
