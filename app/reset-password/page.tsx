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

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next, "/login");

  return (
    <main className="narrow-main auth-main">
      <PageHeader eyebrow="Account" title="重置密码" subtitle="输入邮箱验证码和新密码。" />

      <Pane>
        {params.sent ? (
          <p className="success-message">
            {VERIFICATION_EMAIL_HINT.replace("{email}", params.email ?? "")}
          </p>
        ) : null}
        {params.error ? <p className="error-message">{params.error}</p> : null}
        <form
          action="/api/auth/password-reset/confirm"
          method="post"
          className="stack-form"
        >
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
          <FormField label="新密码">
            <input
              autoComplete="new-password"
              minLength={10}
              name="password"
              required
              type="password"
            />
          </FormField>
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
      </Pane>
    </main>
  );
}
