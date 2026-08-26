import { PageHeader } from "@/app/components/ui/page-header";
import { requireBootstrapAdminPage } from "@/lib/server/auth/authorize";
import { listPermissions, listRoles } from "@/lib/server/db/permissions";
import { PermissionMatrix } from "./permission-matrix";

export const dynamic = "force-dynamic";

export default async function AdminPermissionsPage() {
  await requireBootstrapAdminPage("/admin/permissions");
  const [roles, permissions] = await Promise.all([listRoles(), listPermissions()]);
  return (
    <main>
      <PageHeader title="角色与权限" />
      <PermissionMatrix permissions={permissions} roles={roles} />
    </main>
  );
}
