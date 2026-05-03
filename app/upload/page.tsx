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
            <h1>浏览器预索引导入</h1>
            <p className="subtitle">
              当前账户层级为 {roleLabel(currentUser.role)}，需要上传者或更高层级。
            </p>
          </div>
          <Link className="button" href="/">
            返回首页
          </Link>
        </header>
      </main>
    );
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase D</p>
          <h1>浏览器预索引导入</h1>
          <p className="subtitle">
            选择本地 RPG Maker 2000/2003 游戏目录，浏览器会完成扫描、SHA-256、
            core pack、preflight、缺失对象上传和最终 commit。
          </p>
        </div>
        <div className="session-panel">
          <span className="status-pill">{roleLabel(currentUser.role)}</span>
          <Link className="button" href="/admin/archive-versions">
            归档维护
          </Link>
          <Link className="button" href="/">
            首页
          </Link>
        </div>
      </header>
      <UploadClient />
    </main>
  );
}
