import Link from "next/link";
import { redirect } from "next/navigation";
import { FormField } from "@/app/components/ui/form-field";
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
    <main className="narrow-main auth-main">
      <PageHeader eyebrow="Account" title="登录" subtitle="使用邮箱和密码进入账户。" />

      <Pane>
        {params.reset ? <p className="success-message">密码已更新，请重新登录。</p> : null}
        {params.error ? <p className="error-message">{params.error}</p> : null}
        <form action="/api/auth/login" method="post" className="stack-form">
          <input type="hidden" name="next" value={nextPath} />
          <FormField label="邮箱">
            <input
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
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
            />
          </FormField>
          <button className="button primary" type="submit">
            登录
          </button>
        </form>
        <div className="form-links">
          <Link href={`/register?next=${encodeURIComponent(nextPath)}`}>注册账户</Link>
          <Link href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>
            找回密码
          </Link>
        </div>
      </Pane>
    </main>
  );
}
