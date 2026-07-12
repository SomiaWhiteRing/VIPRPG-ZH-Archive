import Link from "next/link";
import Script from "next/script";
import { FormField } from "@/app/components/ui/form-field";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { getTurnstileSiteKey } from "@/lib/server/auth/config";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";

export const dynamic = "force-dynamic";

type ForgotPasswordPageProps = {
  searchParams: Promise<{
    next?: string;
    email?: string;
    error?: string;
  }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next, "/login");
  return (
    <main className="narrow-main auth-main">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <PageHeader
        eyebrow="Account"
        title="找回密码"
        subtitle="通过邮箱验证码设置新密码。"
      />

      <Pane>
        {params.error ? <p className="error-message">{params.error}</p> : null}
        <form action="/api/auth/password-reset/start" method="post" className="stack-form">
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
          <div className="turnstile-box">
            <div className="cf-turnstile" data-sitekey={getTurnstileSiteKey()} />
          </div>
          <button className="button primary" type="submit">
            发送验证码
          </button>
        </form>
        <div className="form-links">
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link>
        </div>
      </Pane>
    </main>
  );
}
