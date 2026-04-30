import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canUploadRole, roleLabel } from "@/lib/server/auth/roles";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

const checks = [
  {
    title: "管理端原型",
    description: "查看 D1/R2 canonical storage 当前计数和原型 API。",
    href: "/admin",
  },
  {
    title: "D1 连接",
    description: "验证 Worker binding 是否能访问元数据数据库。",
    href: "/api/health/db",
  },
  {
    title: "R2 连接",
    description: "验证归档 bucket binding 是否可读，不写入对象。",
    href: "/api/health/r2",
  },
  {
    title: "运行时",
    description: "返回应用版本和 Cloudflare runtime 的基础状态。",
    href: "/api/health",
  },
];

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const currentUser = await getCurrentUserFromCookies();
  const unreadInboxCount = currentUser
    ? await countUnreadInboxItemsForUser(currentUser)
    : 0;

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">VIPRPG-ZH-Archive</p>
          <h1>RPG Maker 2000/2003 去重归档系统</h1>
          <p className="subtitle">
            当前阶段聚焦 OpenNext、Cloudflare Workers、D1 和 R2
            的基础连通性。归档导入和下载重组会在基础设施验证后继续实现。
          </p>
        </div>
        <div className="session-panel">
          <span className="status-pill">{sessionLabel(currentUser)}</span>
          {currentUser ? (
            <>
              <Link className="button" href="/inbox">
                站内信
                {unreadInboxCount > 0 ? (
                  <span className="notification-badge">
                    {formatUnreadCount(unreadInboxCount)}
                  </span>
                ) : null}
              </Link>
              <form action="/api/auth/logout" method="post" className="inline-form">
                <input type="hidden" name="next" value="/" />
                <button className="button" type="submit">
                  退出
                </button>
              </form>
            </>
          ) : (
            <Link className="button primary" href="/login">
              登录
            </Link>
          )}
        </div>
      </header>

      <section className="grid" aria-label="基础设施检查">
        {checks.map((check) => (
          <article className="card" key={check.href}>
            <h2>{check.title}</h2>
            <p>{check.description}</p>
            <div className="actions">
              <a className="button" href={check.href}>
                打开检查
              </a>
            </div>
          </article>
        ))}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>当前存储边界</h2>
        <p>
          R2 只保存 <span className="mono">blobs/</span>、
          <span className="mono">core-packs/</span> 和{" "}
          <span className="mono">manifests/</span>。完整游戏 ZIP
          只能作为响应流或 Workers Cache/CDN 边缘缓存存在。
        </p>
      </section>

      {currentUser && !canUploadRole(currentUser.role) ? (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>上传者权限</h2>
          <p>当前账户是普通用户。申请会进入站内信系统，由管理员处理。</p>
          <form
            action="/api/account/request-upload-access"
            method="post"
            className="actions"
          >
            <button className="button primary" type="submit">
              申请成为上传者
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}

function sessionLabel(
  user: Awaited<ReturnType<typeof getCurrentUserFromCookies>>,
): string {
  if (!user) {
    return "未登录";
  }

  return `${roleLabel(user.role)}：${user.displayName}`;
}
