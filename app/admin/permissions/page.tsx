import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { listPermissions, listRoles } from "@/app/.server/db/permissions";
import { runtimeContext } from "@/app/.server/router-context";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { PermissionMatrix } from "./permission-matrix";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  await requireBootstrapAdminPage(runtime, "/admin/permissions");
  const [roles, permissions] = await Promise.all([
    listRoles(runtime),
    listPermissions(),
  ]);

  return { roles, permissions };
}

export default function AdminPermissionsPage() {
  const { roles, permissions } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title="角色与权限"
        subtitle="系统角色只读；自定义角色的资料与权限分别保存。"
      />
      <PermissionMatrix permissions={permissions} roles={roles} />
    </main>
  );
}
