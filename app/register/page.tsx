import Link from "next/link";
import Script from "next/script";
import { redirect } from "next/navigation";
import { getTurnstileSiteKey } from "@/lib/server/auth/config";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";

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
    <main className="narrow-main">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <header className="page-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>注册</h1>
          <p className="subtitle">注册后需要管理员批准才可以上传游戏。</p>
        </div>
      </header>

      <section className="card form-card">
        {params.error ? <p className="error-message">{params.error}</p> : null}
        {params.sent ? (
          <VerificationForm email={params.email ?? ""} nextPath={nextPath} />
        ) : (
          <RegisterStartForm nextPath={nextPath} />
        )}
        <div className="form-links">
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link>
        </div>
      </section>
    </main>
  );
}

function RegisterStartForm({ nextPath }: { nextPath: string }) {
  return (
    <form action="/api/auth/register/start" method="post" className="stack-form">
      <input type="hidden" name="next" value={nextPath} />
      <label className="field">
        <span>邮箱</span>
        <input
          autoComplete="email"
          inputMode="email"
          name="email"
          placeholder="name@example.com"
          required
          type="email"
        />
      </label>
      <label className="field">
        <span>密码</span>
        <input
          autoComplete="new-password"
          minLength={10}
          name="password"
          required
          type="password"
        />
      </label>
      <div className="turnstile-box">
        <div className="cf-turnstile" data-sitekey={getTurnstileSiteKey()} />
      </div>
      <button className="button primary" type="submit">
        发送验证码
      </button>
    </form>
  );
}

function VerificationForm({
  email,
  nextPath,
}: {
  email: string;
  nextPath: string;
}) {
  return (
    <form action="/api/auth/register/verify" method="post" className="stack-form">
      <p className="success-message">验证码已发送到 {email}。</p>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="email" value={email} />
      <label className="field">
        <span>验证码</span>
        <input
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          minLength={6}
          name="code"
          pattern="[0-9]{6}"
          required
          type="text"
        />
      </label>
      <button className="button primary" type="submit">
        完成注册
      </button>
    </form>
  );
}
