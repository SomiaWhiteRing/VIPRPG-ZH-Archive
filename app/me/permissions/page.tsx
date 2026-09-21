import { requireAccountUser } from "@/app/.server/auth/account-user";
import { listAccountRoleOptions } from "@/app/.server/db/permissions";
import { runtimeContext } from "@/app/.server/router-context";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { useToast } from "@/app/components/ui/toast";
import type { AccountRoleOption } from "@/lib/dto/db/permissions";
import { notifyInboxChanged } from "@/lib/inbox-events";
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
    <div className="grid gap-6">
      <PageHeader compact title="权限申请" subtitle="选择权限，了解可使用的功能并提交申请。" />
      {role && state ? <>
        <Label className="grid max-w-md gap-2">
          选择权限
          <SelectField aria-label="选择要申请的权限" value={String(role.id)} disabled={busy}
            options={roles.map((item) => ({ value: String(item.id), label: item.name }))}
            onValueChange={(value) => {
              const selected = roles.find((item) => item.id === Number(value));
              if (selected) setParams((current) => {
                current.set("role", selected.key);
                return current;
              }, { replace: true, preventScrollReset: true });
            }} />
        </Label>
        <section className="grid gap-4" aria-labelledby="permission-heading">
          <div>
            <h2 id="permission-heading" className="text-lg font-semibold">{role.name}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{role.description || "暂无权限说明。"}</p>
          </div>
          <ul className="divide-y divide-border border-y border-border">
            {role.permissions.map((permission) => <li key={permission.key} className="py-3">
              <p className="text-sm font-semibold">{permission.label}</p>
              <p className="mt-1 text-sm text-muted">{permission.description}</p>
            </li>)}
          </ul>
          {role.permissions.length === 0 ? <p className="text-sm text-muted">该角色尚未配置功能。</p> : null}
          <p className="text-sm" role="status">{state.message}</p>
          {role.request ? <Link className="w-fit text-sm text-primary" to={`/inbox/${role.request.id}`}>查看最近一次申请</Link> : null}
          {state.canApply ? <form className="grid max-w-2xl gap-3" onSubmit={submit}>
            <Label className="grid gap-2" htmlFor="application-reason">
              申请理由（选填）
              <Textarea id="application-reason" name="reason" maxLength={2000} rows={4} disabled={busy}
                value={reasons[role.id] ?? ""}
                onChange={(event) => setReasons((current) => ({ ...current, [role.id]: event.target.value }))} />
            </Label>
            <p className="text-xs text-muted">最多 2000 字。申请理由仅你和管理员可见。</p>
            <Button className="w-fit" type="submit" disabled={busy}>{busy ? "提交中…" : "提交申请"}</Button>
          </form> : null}
        </section>
      </> : <EmptyState title="目前没有可申请的权限。" />}
    </div>
  );
}

function applicationState(role: AccountRoleOption): { canApply: boolean; message: string } {
  if (role.status !== "active") return { canApply: false, message: "该角色已停用，相关权限暂不生效。" };
  if (role.availableToAll) return { canApply: false, message: "此权限已向所有用户开放，无需申请。" +
    (role.individuallyAssigned ? "你另有单独授权，全员开放收回后仍会保留。" : "") };
  if (role.granted) return { canApply: false, message: "你已拥有此权限。" };
  if (role.request?.status === "pending") return { canApply: false, message: "申请已提交，等待管理员审批。" };
  if (!role.applicationEnabled) return { canApply: false, message: "此权限暂未开放申请。" };
  if (role.request?.status === "rejected") return { canApply: true, message: "上次申请未通过，可以重新申请。" };
  if (role.request?.status === "archived") return { canApply: true, message: "上次申请已关闭，当前已重新开放申请。" };
  if (role.request?.status === "approved") return { canApply: true, message: "之前的申请已通过，当前权限已收回或不完整，可以重新申请。" };
  return { canApply: true, message: "申请提交后，任一管理员处理即可完成审批。" };
}
