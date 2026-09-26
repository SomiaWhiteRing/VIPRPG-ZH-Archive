import { useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { redirectPage } from "@/app/.server/http/page-response";
import { runtimeContext } from "@/app/.server/router-context";
import { VerificationCodeInput } from "@/app/components/auth/auth-input";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { PageHeader } from "@/app/components/ui/page-header";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { useToast } from "@/app/components/ui/toast";
import { ACCOUNT_DELETION_ACKNOWLEDGEMENT } from "@/lib/auth/account-deletion";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const user = await requireAccountUser(runtime, "/me/profile/delete");
  if (user.isBootstrapAdmin) redirectPage("/me/profile");
  return { email: user.email };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["注销账号", "个人中心"] }, error);

export default function DeleteAccountPage() {
  const { email } = useLoaderData<typeof loader>();
  const toast = useToast();
  const [acknowledgement, setAcknowledgement] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const acknowledged = acknowledgement === ACCOUNT_DELETION_ACKNOWLEDGEMENT;

  async function sendCode() {
    if (!acknowledged || sending || submitting) return;
    setSending(true);
    try {
      const body = new FormData();
      body.set("acknowledgement", acknowledgement);
      const response = await fetch("/api/account/delete/start", {
        method: "POST",
        body,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.detail || payload.error || "验证码发送失败，请稍后重试。");
      }
      setSent(true);
      toast.success("注销验证码已发送，请检查当前绑定邮箱。");
    } catch (error) {
      toast.error(
        error instanceof TypeError
          ? "无法连接服务器，请检查网络后重试。"
          : error instanceof Error ? error.message : "验证码发送失败，请稍后重试。",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <PageHeader title="注销账号" />
      <div className="max-w-2xl space-y-6">
        <section
          aria-labelledby="account-deletion-warning"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-5"
        >
          <h2 id="account-deletion-warning" className="font-semibold text-destructive">
            注销后无法恢复，请慎重操作
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>账号将无法登录，所有设备上的登录状态都会失效。</li>
            <li>名称改为“账户已注销”，头像恢复默认，简介及喜爱展柜清空，个人主页内容全部设为不可见。</li>
            <li>已上传作品、评论和其他公共贡献会保留。</li>
          </ul>
        </section>

        <RedirectForm
          action="/api/account/delete"
          className="space-y-6"
          method="post"
          onBusyChange={setSubmitting}
        >
          <div className="space-y-2">
            <Label htmlFor="delete-account-acknowledgement">1. 确认注销后果</Label>
            <p id="delete-account-acknowledgement-help" className="text-sm text-muted">
              请在下方完整输入：
              <strong className="font-semibold text-foreground">{ACCOUNT_DELETION_ACKNOWLEDGEMENT}</strong>
            </p>
            <Input
              id="delete-account-acknowledgement"
              name="acknowledgement"
              autoComplete="off"
              aria-describedby="delete-account-acknowledgement-help"
              value={acknowledgement}
              onChange={(event) => setAcknowledgement(event.target.value)}
              pattern={ACCOUNT_DELETION_ACKNOWLEDGEMENT}
              maxLength={ACCOUNT_DELETION_ACKNOWLEDGEMENT.length}
              readOnly={sending || submitting}
              required
            />
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">2. 验证当前绑定邮箱</h2>
            <p className="break-all text-sm text-muted">
              验证码将发送至 <strong className="font-semibold text-foreground">{email}</strong>
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={!acknowledged || sending || submitting}
              onClick={() => void sendCode()}
            >
              {sending ? "正在发送……" : sent ? "重新发送验证码" : "获取邮箱验证码"}
            </Button>
            {sent ? (
              <Notice tone="success">
                验证码已发送，10 分钟内有效。未收到时请检查垃圾邮件；重新发送后请使用最新验证码。
              </Notice>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="delete-account-code">邮箱验证码</Label>
              <VerificationCodeInput
                id="delete-account-code"
                name="code"
                disabled={!sent || !acknowledged || sending || submitting}
                placeholder="请输入 6 位验证码"
                required
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-5">
            <p className="text-sm text-destructive">点击下方红色按钮后，账号将立即注销，无法撤销。</p>
            <div className="flex flex-wrap items-center justify-end gap-4">
              <Link className="text-sm font-semibold text-primary hover:underline" to="/me/profile">
                取消，返回个人资料
              </Link>
              <Button
                type="submit"
                variant="destructive"
                disabled={!acknowledged || !sent || sending || submitting}
              >
                {submitting ? "正在注销……" : "永久注销账号"}
              </Button>
            </div>
          </div>
        </RedirectForm>
      </div>
    </div>
  );
}
