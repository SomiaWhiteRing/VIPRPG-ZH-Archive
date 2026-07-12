import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canUploadRole } from "@/lib/server/auth/roles";
import { UploadClient } from "@/app/upload/upload-client";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect("/login?next=/upload");
  }

  if (!canUploadRole(currentUser.role)) {
    return (
      <main>
        <PageHeader eyebrow="Upload" title="需要上传者权限" />

        <Pane>
          <p>上传需要上传者权限，可在「我的账户」申请。</p>
          <div className="actions">
            <Link className="button primary" href="/me">
              前往我的账户
            </Link>
          </div>
        </Pane>
      </main>
    );
  }

  return (
    <main>
      <PageHeader
        actions={
          <Link className="button" href="/upload/tasks">
            查看导入任务
          </Link>
        }
        eyebrow="Upload Workspace"
        subtitle="选择本地 RPG Maker 2000/2003 游戏目录，浏览器会完成检查并上传缺少的文件。"
        title="上传归档"
      />
      <UploadClient />
    </main>
  );
}
