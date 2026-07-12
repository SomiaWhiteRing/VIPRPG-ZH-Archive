import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canUploadRole } from "@/lib/server/auth/roles";
import { UploadClient } from "@/app/upload/upload-client";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect("/login?next=/upload");
  }

  if (!canUploadRole(currentUser.role)) {
    return (
      <main>
        <header className="page-header">
          <div>
            <p className="eyebrow">Upload</p>
            <h1>需要上传者权限</h1>
          </div>
        </header>

        <section className="card">
          <p>上传需要上传者权限，可在「我的账户」申请。</p>
          <div className="actions">
            <Link className="button primary" href="/me">
              前往我的账户
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Upload Workspace</p>
          <h1>上传归档</h1>
          <p className="subtitle">
            选择本地 RPG Maker 2000/2003 游戏目录，浏览器会完成检查并上传缺少的文件。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button" href="/upload/tasks">
            查看导入任务
          </Link>
        </div>
      </header>
      <UploadClient />
    </main>
  );
}
