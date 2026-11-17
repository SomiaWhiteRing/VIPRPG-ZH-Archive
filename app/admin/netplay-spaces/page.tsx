import { useState } from "react";
import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { listNetplaySpaces } from "@/app/.server/db/netplay-spaces";
import { runtimeContext } from "@/app/.server/router-context";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { SelectField } from "@/app/components/ui/select";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { isAdministrator } from "@/lib/authz/roles";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const user = await requirePagePermission(runtime, "/admin/netplay-spaces", "system.maintenance.run");
  return { spaces: await listNetplaySpaces(runtime), canReadMatches: isAdministrator(user), locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.works.space"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

function SpaceForm({ space }: { space?: Awaited<ReturnType<typeof listNetplaySpaces>>[number] }) {
  const t = useMessages();
  const id = `netplay-space-${space?.id ?? "new"}`;
  const [provider, setProvider] = useState(space?.external_endpoint ? "external" : "cloudflare");
  return <RedirectForm action="/api/admin/netplay-spaces" className="grid gap-3" preserveLanguage>
    {space ? <input type="hidden" name="space_id" value={space.id} /> : null}
    <FormField controlId={`${id}-name`} label={t("admin.characterList.name")}>
      <Input id={`${id}-name`} name="name" defaultValue={space?.name} required maxLength={80} />
    </FormField>
    <FormField controlId={`${id}-provider`} label={t("admin.netplay.hosting")}>
      <SelectField id={`${id}-provider`} name="provider" value={provider} onValueChange={setProvider}
        options={[{ value: "cloudflare", label: "Cloudflare" }, { value: "external", label: t("admin.netplay.external") }]} />
    </FormField>
    {provider === "external" ? <FormField controlId={`${id}-endpoint`} label={t("admin.netplay.endpoint")}>
      <Input id={`${id}-endpoint`} name="external_endpoint" type="url" defaultValue={space?.external_endpoint ?? ""}
        required maxLength={2048} />
    </FormField> : null}
    <div><Button type="submit">{space ? t("core.action.save") : t("admin.netplay.create")}</Button></div>
  </RedirectForm>;
}

export default function NetplaySpacesPage() {
  const t = useMessages();
  const { spaces, canReadMatches } = useLoaderData<typeof loader>();
  return <main className="grid gap-4">
    <PageHeader compact title={t("admin.works.space")} actions={canReadMatches ? (
      <Link className={buttonVariants({ variant: "outline" })} to="/admin/netplay-spaces/matches">{t("admin.netplay.matches")}</Link>
    ) : null} />
    <RedirectFeedback />
    <Pane heading={t("admin.netplay.createSpace")}><SpaceForm /></Pane>
    {spaces.map((space) => <details key={space.id} className="admin-panel admin-details">
      <summary>{space.name} · {space.external_endpoint ? t("admin.netplay.external") : "Cloudflare"}</summary>
      <div className="mt-4"><SpaceForm space={space} /></div>
    </details>)}
  </main>;
}
