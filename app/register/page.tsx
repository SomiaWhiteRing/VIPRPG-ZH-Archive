import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  EmailInput,
  PasswordInput,
  VerificationCodeInput,
} from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { getCurrentUser } from "@/app/.server/auth/current-user";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { redirectPage } from "@/app/.server/http/page-response";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { VERIFICATION_EMAIL_HINT } from "@/lib/labels";
import { Link } from "react-router";
import { RedirectForm } from "@/app/components/ui/redirect-form";

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

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "注册" }, error);

export default function RegisterPage() {
  const { params, nextPath } = useLoaderData<typeof loader>();
  return (
    <AuthPageShell
      title="注册"
      footer={
        <>
          <Link to={`/login?next=${encodeURIComponent(nextPath)}`}>
            返回登录
          </Link>
        </>
      }
    >
      <RedirectFeedback />
      {params.sent ? (
        <VerificationForm email={params.email ?? ""} nextPath={nextPath} />
      ) : (
        <RegisterStartForm
          nextPath={nextPath}
          email={params.email ?? ""}
          displayName={params.displayName ?? ""}
        />
      )}
    </AuthPageShell>
  );
}

function RegisterStartForm({ nextPath, email, displayName }: {
  nextPath: string;
  email: string;
  displayName: string;
}) {
  return (
    <RedirectForm
      action="/api/auth/register/start"
      method="post"
      className="grid gap-4"
      onInput={(event) => {
        const fields = event.currentTarget.elements;
        const password = fields.namedItem("password");
        const confirmation = fields.namedItem("confirmPassword");
        if (password instanceof HTMLInputElement && confirmation instanceof HTMLInputElement) {
          confirmation.setCustomValidity(
            confirmation.value && confirmation.value !== password.value
              ? "两次输入的密码不一致" : "",
          );
        }
      }}
    >
      <input type="hidden" name="next" value={nextPath} />
      <FormField controlId="register-display-name" label="显示名">
        <Input
          id="register-display-name"
          name="displayName"
          autoComplete="nickname"
          defaultValue={displayName}
          maxLength={80}
          required
        />
      </FormField>
      <FormField controlId="register-field-1" label="邮箱">
        <EmailInput
          id="register-field-1"
          name="email"
          defaultValue={email}
          placeholder={undefined}
          required
        />
      </FormField>
      <FormField controlId="register-field-2" label="密码">
        <PasswordInput
          id="register-field-2"
          purpose="new"
          name="password"
          placeholder="8到20位的数字、字母或符号"
          required
        />
      </FormField>
      <FormField controlId="register-confirm-password" label="确认密码">
        <PasswordInput
          id="register-confirm-password"
          purpose="new"
          name="confirmPassword"
          required
        />
      </FormField>
      <Button type="submit">发送验证码</Button>
    </RedirectForm>
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
    <RedirectForm
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
    </RedirectForm>
  );
}
