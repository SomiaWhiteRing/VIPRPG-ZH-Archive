import { PageHeader } from "@/app/components/ui/page-header";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { requireAccountUser } from "@/lib/server/auth/account-user";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type Params = {
  passwordUpdated?: string;
  error?: string;
};

export default async function PasswordPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAccountUser("/me/profile/password");
  const params = await searchParams;

  return (
    <div>
      <PageHeader title="修改密码" />
      {params.passwordUpdated ? <p className="mb-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">密码已更新，其他设备已登出。</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">{params.error}</p> : null}
      <form action="/api/account/password" className="grid gap-4" method="post">
        <PasswordField htmlFor="password-current" label="当前密码">
          <Input autoComplete="current-password" id="password-current" name="currentPassword" required type="password" />
        </PasswordField>
        <PasswordField htmlFor="password-new" label="新密码">
          <Input autoComplete="new-password" id="password-new" minLength={12} name="newPassword" required type="password" />
        </PasswordField>
        <PasswordField htmlFor="password-confirm" label="再次输入新密码">
          <Input autoComplete="new-password" id="password-confirm" minLength={12} name="confirmPassword" required type="password" />
        </PasswordField>
        <p className="m-0 text-xs text-muted md:pl-[174px]">新密码长度为 12 至 256 个字符。</p>
        <div className="md:pl-[174px]"><Rm2kButton type="submit">修改密码</Rm2kButton></div>
      </form>
    </div>
  );
}

function PasswordField({ htmlFor, label, children }: { htmlFor: string; label: string; children: ReactNode }) {
  return <div className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)] md:items-center"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}
