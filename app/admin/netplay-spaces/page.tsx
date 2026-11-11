import { useState } from "react";
import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { listNetplaySpaces } from "@/app/.server/db/netplay-spaces";
import { runtimeContext } from "@/app/.server/router-context";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { SelectField } from "@/app/components/ui/select";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  await requirePagePermission(runtime, "/admin/netplay-spaces", "system.maintenance.run");
  return { spaces: await listNetplaySpaces(runtime) };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["联机空间", "控制台"] }, error);

function SpaceForm({ space }: { space?: Awaited<ReturnType<typeof listNetplaySpaces>>[number] }) {
  const id = `netplay-space-${space?.id ?? "new"}`;
  const [provider, setProvider] = useState(space?.external_endpoint ? "external" : "cloudflare");
  return <RedirectForm action="/api/admin/netplay-spaces" className="grid gap-3">
    {space ? <input type="hidden" name="space_id" value={space.id} /> : null}
    <FormField controlId={`${id}-name`} label="名称">
      <Input id={`${id}-name`} name="name" defaultValue={space?.name} required maxLength={80} />
    </FormField>
    <FormField controlId={`${id}-provider`} label="托管">
      <SelectField id={`${id}-provider`} name="provider" value={provider} onValueChange={setProvider}
        options={[{ value: "cloudflare", label: "Cloudflare" }, { value: "external", label: "外部服务器" }]} />
    </FormField>
    {provider === "external" ? <FormField controlId={`${id}-endpoint`} label="联机地址">
      <Input id={`${id}-endpoint`} name="external_endpoint" type="url" defaultValue={space?.external_endpoint ?? ""}
        required maxLength={2048} />
    </FormField> : null}
    <div><Button type="submit">{space ? "保存" : "创建"}</Button></div>
  </RedirectForm>;
}

export default function NetplaySpacesPage() {
  const { spaces } = useLoaderData<typeof loader>();
  return <main className="grid gap-4">
    <PageHeader compact title="联机空间" />
    <RedirectFeedback />
    <Pane heading="创建空间"><SpaceForm /></Pane>
    {spaces.map((space) => <details key={space.id} className="admin-panel admin-details">
      <summary>{space.name} · {space.external_endpoint ? "外部服务器" : "Cloudflare"}</summary>
      <div className="mt-4"><SpaceForm space={space} /></div>
    </details>)}
  </main>;
}
