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
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-12 mx-auto w-full max-w-md">
      <PageHeader title="找回密码" subtitle="通过邮箱验证码设置新密码。" />

      <Pane>
        {params.error ? (
          <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{params.error}</p>
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
    </main>
  );
}
