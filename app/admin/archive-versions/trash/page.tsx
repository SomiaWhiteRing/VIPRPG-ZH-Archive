import { requirePagePermission } from "@/app/.server/auth/authorize";
import { listArchiveVersionsForAdmin } from "@/app/.server/db/archive-maintenance";
import { pickPageFields } from "@/app/.server/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/archive-versions/trash",
    "archive_version.restore",
  );
  const archiveVersions = await listArchiveVersionsForAdmin(
    runtime,
    150,
    "trash",
    adminUser,
  );

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    archiveVersions,
  };
}

export default function AdminArchiveVersionTrashPage() {
  const { adminUser, archiveVersions } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        title="已删除版本"
        subtitle="还原后会重新发布；同组没有最新快照时，会自动成为最新快照。"
        actions={
          <BackLink href="/admin/archive-versions" label="返回版本管理" />
        }
      />

      <ArchiveVersionTable
        actor={adminUser}
        archiveVersions={archiveVersions}
        mode="trash"
      />
    </main>
  );
}
