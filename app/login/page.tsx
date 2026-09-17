import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { EmailInput, PasswordInput } from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { getCurrentUser } from "@/app/.server/auth/current-user";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { redirectPage } from "@/app/.server/http/page-response";
import { FormField } from "@/app/components/ui/form-field";
import { Notice } from "@/app/components/ui/notice";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
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

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "登录" }, error);

export default function LoginPage() {
  const { params, nextPath } = useLoaderData<typeof loader>();
  return (
    <AuthPageShell
      title="登录"
      subtitle="使用邮箱和密码进入账户。"
      footer={
        <>
          <Link to={`/register?next=${encodeURIComponent(nextPath)}`}>
            注册账户
          </Link>
          <Link to={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>
            找回密码
          </Link>
        </>
      }
    >
      {params.reset ? (
        <Notice tone="success" className="mb-4 rounded-md border p-3">
          密码已更新，请重新登录。
        </Notice>
      ) : null}
      {params.error ? (
        <Notice tone="error" className="mb-4 rounded-md border p-3">
          {params.error}
        </Notice>
      ) : null}
      <form action="/api/auth/login" method="post" className="grid gap-4">
        <input type="hidden" name="next" value={nextPath} />
        <FormField controlId="login-field-1" label="邮箱">
          <EmailInput
            id="login-field-1"
            defaultValue={params.email ?? ""}
            name="email"
            placeholder="name@example.com"
            required
          />
        </FormField>
        <FormField controlId="login-field-2" label="密码">
          <PasswordInput id="login-field-2" name="password" required />
        </FormField>
        <Rm2kButton type="submit">登录</Rm2kButton>
      </form>
    </AuthPageShell>
  );
}
