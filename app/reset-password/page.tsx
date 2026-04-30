import Link from "next/link";
import { getEmailFrom } from "@/lib/server/auth/config";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";

export const dynamic = "force-dynamic";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    next?: string;
    email?: string;
    sent?: string;
    error?: string;
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next, "/login");
  const emailFrom = getEmailFrom();

  return (
    <main className="narrow-main">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>重置密码</h1>
          <p className="subtitle">输入邮箱验证码和新密码。</p>
        </div>
      </header>

      <section className="card form-card">
        {params.sent ? (
          <p className="success-message">
            验证码已发送到 {params.email}。如果几分钟内没收到，请检查垃圾邮件或广告邮件，并确认发件人{" "}
            {emailFrom} 未被拦截。
          </p>
        ) : null}
        {params.error ? <p className="error-message">{params.error}</p> : null}
        <form
          action="/api/auth/password-reset/confirm"
          method="post"
          className="stack-form"
        >
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
          <label className="field">
            <span>新密码</span>
            <input
              autoComplete="new-password"
              minLength={10}
              name="password"
              required
              type="password"
            />
          </label>
          <button className="button primary" type="submit">
            更新密码
          </button>
        </form>
        <div className="form-links">
          <Link href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>
            重新发送验证码
          </Link>
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link>
        </div>
      </section>
    </main>
  );
}
