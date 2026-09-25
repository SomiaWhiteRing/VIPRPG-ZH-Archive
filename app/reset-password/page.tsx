import { routeInput } from "@/app/.server/route-input";
import {
  EmailInput,
  PasswordInput,
  VerificationCodeInput,
} from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Notice } from "@/app/components/ui/notice";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { VERIFICATION_EMAIL_HINT } from "@/lib/labels";
import { Link } from "react-router";
import { RedirectForm } from "@/app/components/ui/redirect-form";

export async function loader(args: LoaderFunctionArgs) {
  const { searchParams } = routeInput(args);

  const params = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const nextPath = sanitizeRedirectPath(params.next, "/login");

  return { params, nextPath };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "重置密码" }, error);

export default function ResetPasswordPage() {
  const { params, nextPath } = useLoaderData<typeof loader>();
  return (
    <AuthPageShell
      title="重置密码"
      footer={
        <>
          <Link to={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>
            重新发送验证码
          </Link>
          <Link to={`/login?next=${encodeURIComponent(nextPath)}`}>
            返回登录
          </Link>
        </>
      }
    >
      {params.sent ? (
        <Notice tone="success" className="mb-4 rounded-md border p-3">
          {VERIFICATION_EMAIL_HINT.replace("{email}", params.email ?? "")}
        </Notice>
      ) : null}
      <RedirectFeedback />
      <RedirectForm
        action="/api/auth/password-reset/confirm"
        method="post"
        className="grid gap-4"
      >
        <input type="hidden" name="next" value={nextPath} />
        <FormField controlId="reset-password-field-1" label="邮箱">
          <EmailInput
            id="reset-password-field-1"
            defaultValue={params.email ?? ""}
            name="email"
            placeholder="name@example.com"
            required
          />
        </FormField>
        <FormField controlId="reset-password-field-2" label="验证码">
          <VerificationCodeInput
            id="reset-password-field-2"
            name="code"
            required
          />
        </FormField>
        <FormField controlId="reset-password-field-3" label="新密码">
          <PasswordInput
            id="reset-password-field-3"
            purpose="new"
            name="password"
            required
          />
        </FormField>
        <Button type="submit">更新密码</Button>
      </RedirectForm>
    </AuthPageShell>
  );
}
