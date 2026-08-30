import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { hasPermission } from "@/lib/authz/permissions";
import { UploadClient } from "@/app/upload/upload-client";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect("/login?next=/upload");
  }

  if (
    !hasPermission(currentUser, "import_job.create") &&
    !hasPermission(currentUser, "work.external_create")
  ) {
    return (
      <main>
        <PageHeader title="需要上传者权限" />

        <Pane>
          <p>上传需要上传者权限，可在「我的账户」申请。</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link className={buttonVariants()} href="/me">
              前往我的账户
            </Link>
          </div>
        </Pane>
      </main>
    );
  }

  return (
    <main>
      <PageHeader subtitle="2000/2003 系游戏可上传本地文件，其他引擎请填写外部下载地址。" title="上传游戏" />
      <UploadClient
        currentUser={{
          id: currentUser.id,
          permissionKeys: currentUser.permissionKeys,
        }}
      />
    </main>
  );
}
