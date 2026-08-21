import Link from "next/link";
import Script from "next/script";
import { redirect } from "next/navigation";
import { FormField } from "@/app/components/ui/form-field";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import {
  getTurnstileSiteKey,
  isTurnstileEnabled,
} from "@/lib/server/auth/config";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { VERIFICATION_EMAIL_HINT } from "@/lib/labels";

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
  const turnstileKey = isTurnstileEnabled() ? getTurnstileSiteKey() : null;

  if (currentUser) {
    redirect(nextPath);
  }

  return (
    <main className="narrow-main auth-main">
      {turnstileKey ? (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      ) : null}
      <PageHeader
        eyebrow="Account"
        title="注册"
        subtitle="注册后需要管理员批准才可以上传游戏。"
      />

      <Pane>
        {params.error ? <p className="error-message">{params.error}</p> : null}
        {params.sent ? (
          <VerificationForm email={params.email ?? ""} nextPath={nextPath} />
        ) : (
          <RegisterStartForm nextPath={nextPath} turnstileKey={turnstileKey} />
        )}
        <div className="form-links">
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link>
        </div>
      </Pane>
    </main>
  );
}

function RegisterStartForm({ nextPath, turnstileKey }: { nextPath: string; turnstileKey: string | null }) {
  return (
    <form action="/api/auth/register/start" method="post" className="stack-form">
      <input type="hidden" name="next" value={nextPath} />
      <FormField label="邮箱">
        <input
          autoComplete="email"
          inputMode="email"
          name="email"
          placeholder="name@example.com"
          required
          type="email"
        />
      </FormField>
      <FormField label="密码">
        <input
          autoComplete="new-password"
          minLength={10}
          name="password"
          required
          type="password"
        />
      </FormField>
      {turnstileKey ? (
        <div className="turnstile-box">
          <div className="cf-turnstile" data-sitekey={turnstileKey} />
        </div>
      ) : null}
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
      <p className="success-message">
        {VERIFICATION_EMAIL_HINT.replace("{email}", email)}
      </p>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="email" value={email} />
      <FormField label="验证码">
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
      </FormField>
      <button className="button primary" type="submit">
        完成注册
      </button>
    </form>
  );
}
