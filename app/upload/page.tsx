import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canUploadRole, roleLabel } from "@/lib/server/auth/roles";
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
            <p className="subtitle">
              当前账户层级为 {roleLabel(currentUser.role)}，需要上传者或更高层级才能进入上传工作区。
            </p>
          </div>
        </header>

        <section className="card" style={{ marginTop: 16 }}>
          <h2>申请上传者</h2>
          <p>
            你可以在「我的账户」页提交申请。管理员处理后会通过站内信通知你。
          </p>
          <div className="actions">
            <Link className="button primary" href="/me">
              前往我的账户
            </Link>
            <Link className="button" href="/about">
              了解归档结构
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
          <h1>浏览器预索引导入</h1>
          <p className="subtitle">
            选择本地 RPG Maker 2000/2003 游戏目录，浏览器会完成扫描、SHA-256、core pack、preflight、缺失对象上传与最终 commit。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button" href="/upload/tasks">
            我的导入任务
          </Link>
        </div>
      </header>
      <UploadClient />
    </main>
  );
}
