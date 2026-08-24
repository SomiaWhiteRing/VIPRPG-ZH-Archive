import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import Link from "next/link";
import Script from "next/script";
import { redirect } from "next/navigation";
import { FormField } from "@/app/components/ui/form-field";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { getTurnstileSiteKey, isTurnstileEnabled } from "@/lib/server/auth/config";
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
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-12 mx-auto w-full max-w-md">
      {turnstileKey ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer /> : null}
      <PageHeader eyebrow="Account" title="注册" subtitle="注册后需要管理员批准才可以上传游戏。" />

      <Pane>
        {params.error ? (
          <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{params.error}</p>
        ) : null}
        {params.sent ? (
          <VerificationForm email={params.email ?? ""} nextPath={nextPath} />
        ) : (
          <RegisterStartForm nextPath={nextPath} turnstileKey={turnstileKey} />
        )}
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-primary">
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>返回登录</Link>
        </div>
      </Pane>
    </main>
  );
}

function RegisterStartForm({ nextPath, turnstileKey }: { nextPath: string; turnstileKey: string | null }) {
  return (
    <form action="/api/auth/register/start" method="post" className="grid gap-4">
      <input type="hidden" name="next" value={nextPath} />
      <FormField label="邮箱">
        <Input
          autoComplete="email"
          inputMode="email"
          name="email"
          placeholder="name@example.com"
          required
          type="email"
        />
      </FormField>
      <FormField label="密码">
        <Input autoComplete="new-password" minLength={10} name="password" required type="password" />
      </FormField>
      {turnstileKey ? (
        <div className="min-h-16">
          <div className="min-h-16" data-sitekey={turnstileKey} />
        </div>
      ) : null}
      <Button type="submit">发送验证码</Button>
    </form>
  );
}

function VerificationForm({ email, nextPath }: { email: string; nextPath: string }) {
  return (
    <form action="/api/auth/register/verify" method="post" className="grid gap-4">
      <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-800">
        {VERIFICATION_EMAIL_HINT.replace("{email}", email)}
      </p>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="email" value={email} />
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
      <Button type="submit">完成注册</Button>
    </form>
  );
}
