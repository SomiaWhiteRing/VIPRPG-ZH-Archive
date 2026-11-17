import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { listPermissions, listRoles } from "@/app/.server/db/permissions";
import { runtimeContext } from "@/app/.server/router-context";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { PermissionMatrix } from "./permission-matrix";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  await requireBootstrapAdminPage(runtime, "/admin/permissions");
  const [roles, permissions] = await Promise.all([
    listRoles(runtime),
    listPermissions(),
  ]);

  return { roles, permissions, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.dashboard.roles"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function AdminPermissionsPage() {
  const t = useMessages();
  const { roles, permissions } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title={t("admin.dashboard.roles")}
        subtitle={t("admin.permissions.subtitle")}
      />
      <PermissionMatrix permissions={permissions} roles={roles} />
    </main>
  );
}
