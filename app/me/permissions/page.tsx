import { requireAccountUser } from "@/app/.server/auth/account-user";
import { listAccountRoleOptions } from "@/app/.server/db/permissions";
import { runtimeContext } from "@/app/.server/router-context";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { Textarea } from "@/app/components/ui/textarea";
import { useToast } from "@/app/components/ui/toast";
import type { AccountRoleOption } from "@/lib/dto/db/permissions";
import { notifyInboxChanged } from "@/lib/inbox-events";
import { cn } from "@/lib/ui/cn";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { useState, useTransition, type FormEvent } from "react";
import { Link, useLoaderData, useRevalidator, useSearchParams, type LoaderFunctionArgs, type MetaFunction } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const user = await requireAccountUser(runtime, "/me/permissions");
  return { roles: await listAccountRoleOptions(runtime, user) };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["权限申请", "个人中心"] }, error);

export default function AccountPermissionsPage() {
  const { roles } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const selectedKey = params.get("role");
  const role = roles.find((item) => item.key === selectedKey) ?? roles[0];
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const revalidator = useRevalidator();
  const toast = useToast();
  const state = role ? applicationState(role) : null;
  const busy = saving || refreshing;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role || !state?.canApply || busy) return;
    setSaving(true);
    try {
      const response = await fetch("/api/account/role-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: role.id, reason: reasons[role.id] ?? "" }),
      });
      const result = await response.json() as { ok?: boolean; detail?: string; error?: string };
      if (!response.ok || !result.ok) {
        if (response.status === 409) startTransition(() => revalidator.revalidate());
        throw new Error(result.detail ?? result.error ?? "申请提交失败，请重试。");
      }
      setReasons((current) => ({ ...current, [role.id]: "" }));
      notifyInboxChanged();
      startTransition(() => revalidator.revalidate());
      toast.success("申请已提交，请在提醒中查看处理结果。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "申请提交失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="权限申请" />
      {role && state ? (
        <div className="grid items-start gap-5 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-6">
          <nav className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-1" aria-label="选择要申请的权限">
            {roles.map((item) => {
              const itemState = applicationState(item);
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="outline"
                  className={cn(
                    "h-auto min-w-0 flex-col items-start gap-2 whitespace-normal p-3 text-left hover:bg-primary/5",
                    item.id === role.id && "border-primary bg-primary/10",
                  )}
                  aria-pressed={item.id === role.id}
                  aria-controls="permission-detail"
                  disabled={busy}
                  onClick={() => setParams((current) => {
                    current.set("role", item.key);
                    return current;
                  }, { replace: true, preventScrollReset: true })}
                >
                  <span className="max-w-full break-words">{item.name}</span>
                  <Badge variant={itemState.variant}>{itemState.label}</Badge>
                </Button>
              );
            })}
          </nav>
          <Card id="permission-detail" className="grid min-w-0 gap-4 p-4 sm:p-6" aria-labelledby="permission-heading">
            <div>
              <h2 id="permission-heading" className="break-words text-lg font-semibold">{role.name}</h2>
              {role.description ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{role.description}</p>
              ) : null}
            </div>
            {state.message ? <p className="text-sm text-muted" role="status">{state.message}</p> : null}
            {role.request ? (
              <Link className="w-fit text-sm text-primary hover:underline" to={`/inbox/${role.request.id}`}>
                查看最近一次申请
              </Link>
            ) : null}
            {state.canApply ? (
              <form className="grid gap-3 border-t border-border pt-5" onSubmit={submit}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="application-reason">
                    申请理由<span className="font-normal text-muted">（选填）</span>
                  </Label>
                  <span id="application-reason-count" className="text-xs tabular-nums text-muted">
                    {(reasons[role.id] ?? "").length} / 2000
                  </span>
                </div>
                <Textarea
                  id="application-reason"
                  name="reason"
                  aria-describedby="application-reason-count application-reason-privacy"
                  maxLength={2000}
                  rows={5}
                  disabled={busy}
                  value={reasons[role.id] ?? ""}
                  onChange={(event) => setReasons((current) => ({ ...current, [role.id]: event.target.value }))}
                />
                <p id="application-reason-privacy" className="text-xs text-muted">仅你和管理员可见。</p>
                <div className="flex justify-end pt-2">
                  <Rm2kButton type="submit" disabled={busy}>
                    {busy ? "提交中…" : role.request ? "重新提交申请" : "提交申请"}
                  </Rm2kButton>
                </div>
              </form>
            ) : null}
          </Card>
        </div>
      ) : <EmptyState title="目前没有可申请的权限。" />}
    </div>
  );
}

function applicationState(role: AccountRoleOption): {
  canApply: boolean;
  label: string;
  variant: "subtle" | "positive" | "pending" | "neutral";
  message: string | null;
} {
  if (role.status !== "active") return {
    canApply: false, label: "已停用", variant: "neutral", message: "该角色已停用，相关权限暂不生效。",
  };
  if (role.availableToAll) return {
    canApply: false, label: "全员开放", variant: "positive",
    message: "已向所有用户开放，无需申请。" + (role.individuallyAssigned ? "你另有单独授权，全员开放收回后仍会保留。" : ""),
  };
  if (role.granted) return {
    canApply: false, label: "已拥有", variant: "positive", message: "你已拥有此权限。",
  };
  if (role.request?.status === "pending") return {
    canApply: false, label: "待审核", variant: "pending", message: "申请已提交，等待管理员审核。",
  };
  if (!role.applicationEnabled) return {
    canApply: false, label: "暂未开放", variant: "neutral", message: "此权限暂未开放申请。",
  };
  if (role.request?.status === "rejected") return {
    canApply: true, label: "可重新申请", variant: "pending", message: "上次申请未通过，可以重新申请。",
  };
  if (role.request?.status === "archived") return {
    canApply: true, label: "可重新申请", variant: "subtle", message: "上次申请已关闭，现已重新开放。",
  };
  if (role.request?.status === "approved") return {
    canApply: true, label: "可重新申请", variant: "pending", message: "之前的申请已通过，当前权限已收回或不完整，可以重新申请。",
  };
  return { canApply: true, label: "可申请", variant: "subtle", message: null };
}
