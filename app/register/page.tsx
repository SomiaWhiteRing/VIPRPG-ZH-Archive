import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  EmailInput,
  PasswordInput,
  VerificationCodeInput,
} from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { getCurrentUser } from "@/app/.server/auth/current-user";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { redirectPage } from "@/app/.server/http/page-response";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Notice } from "@/app/components/ui/notice";
import { VERIFICATION_EMAIL_HINT } from "@/lib/labels";
import { Link } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const nextPath = sanitizeRedirectPath(params.next);
  const currentUser = await getCurrentUser(runtime);

  if (currentUser) {
    redirectPage(nextPath);
  }

  return { params, nextPath };
}

export default function RegisterPage() {
  const { params, nextPath } = useLoaderData<typeof loader>();
  return (
    <AuthPageShell
      title="注册"
      subtitle="注册后需要管理员批准才可以上传游戏。"
      footer={
        <>
          <Link to={`/login?next=${encodeURIComponent(nextPath)}`}>
            返回登录
          </Link>
        </>
      }
    >
      {params.error ? (
        <Notice tone="error" className="mb-4 rounded-md border p-3">
          {params.error}
        </Notice>
      ) : null}
      {params.sent ? (
        <VerificationForm email={params.email ?? ""} nextPath={nextPath} />
      ) : (
        <RegisterStartForm nextPath={nextPath} />
      )}
    </AuthPageShell>
  );
}

function RegisterStartForm({ nextPath }: { nextPath: string }) {
  return (
    <form
      action="/api/auth/register/start"
      method="post"
      className="grid gap-4"
    >
      <input type="hidden" name="next" value={nextPath} />
      <FormField controlId="register-field-1" label="邮箱">
        <EmailInput
          id="register-field-1"
          name="email"
          placeholder="name@example.com"
          required
        />
      </FormField>
      <FormField controlId="register-field-2" label="密码">
        <PasswordInput
          id="register-field-2"
          purpose="new"
          name="password"
          required
        />
      </FormField>
      <Button type="submit">发送验证码</Button>
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
    <form
      action="/api/auth/register/verify"
      method="post"
      className="grid gap-4"
    >
      <Notice tone="success" className="mb-4 rounded-md border p-3">
        {VERIFICATION_EMAIL_HINT.replace("{email}", email)}
      </Notice>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="email" value={email} />
      <FormField controlId="register-field-3" label="验证码">
        <VerificationCodeInput id="register-field-3" name="code" required />
      </FormField>
      <Button type="submit">完成注册</Button>
    </form>
  );
}
