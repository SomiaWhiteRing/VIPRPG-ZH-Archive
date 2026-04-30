import Link from "next/link";
import Script from "next/script";
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
    <main className="narrow-main">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <header className="page-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>找回密码</h1>
          <p className="subtitle">通过邮箱验证码设置新密码。</p>
        </div>
      </header>

      <section className="card form-card">
        {params.error ? <p className="error-message">{params.error}</p> : null}
        <form action="/api/auth/password-reset/start" method="post" className="stack-form">
          <input type="hidden" name="next" value={nextPath} />
          <label className="field">
            <span>邮箱</span>
            <input
              autoComplete="email"
              defaultValue={params.email ?? ""}
              inputMode="email"
              name="email"
              placeholder="name@example.com"
              required
              type="email"
            />
          </label>
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
      </section>
    </main>
  );
}
