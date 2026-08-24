import { Input } from "@/app/components/ui/input";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormField } from "@/app/components/ui/form-field";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
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
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-12 mx-auto w-full max-w-md">
      <PageHeader eyebrow="Account" title="登录" subtitle="使用邮箱和密码进入账户。" />

      <Pane>
        {params.reset ? (
          <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-800">
            密码已更新，请重新登录。
          </p>
        ) : null}
        {params.error ? (
          <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{params.error}</p>
        ) : null}
        <form action="/api/auth/login" method="post" className="grid gap-4">
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
          <FormField label="密码">
            <Input autoComplete="current-password" name="password" required type="password" />
          </FormField>
          <Rm2kButton type="submit">登录</Rm2kButton>
        </form>
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-primary">
          <Link href={`/register?next=${encodeURIComponent(nextPath)}`}>注册账户</Link>
          <Link href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>找回密码</Link>
        </div>
      </Pane>
    </main>
  );
}
