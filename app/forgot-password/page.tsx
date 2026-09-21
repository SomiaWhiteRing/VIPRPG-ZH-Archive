import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { routeInput } from "@/app/.server/route-input";
import { EmailInput } from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { Link } from "react-router";

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
  pageMetaDescriptors({ title: "找回密码" }, error);

export default function ForgotPasswordPage() {
  const { params, nextPath } = useLoaderData<typeof loader>();
  return (
    <AuthPageShell
      title="找回密码"
      footer={
        <>
          <Link to={`/login?next=${encodeURIComponent(nextPath)}`}>
            返回登录
          </Link>
        </>
      }
    >
      <RedirectFeedback />
      <form
        action="/api/auth/password-reset/start"
        method="post"
        className="grid gap-4"
      >
        <input type="hidden" name="next" value={nextPath} />
        <FormField controlId="forgot-password-field-1" label="邮箱">
          <EmailInput
            id="forgot-password-field-1"
            defaultValue={params.email ?? ""}
            name="email"
            placeholder="name@example.com"
            required
          />
        </FormField>
        <Button type="submit">发送验证码</Button>
      </form>
    </AuthPageShell>
  );
}
