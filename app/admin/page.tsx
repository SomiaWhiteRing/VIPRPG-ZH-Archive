import { getAdminSummary } from "@/lib/server/db/admin-summary";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import Link from "next/link";

export const dynamic = "force-dynamic";

const links = [
  {
    href: "/api/admin/summary",
    label: "摘要 API",
  },
  {
    href: "/api/health/db",
    label: "D1 检查",
  },
  {
    href: "/api/health/r2",
    label: "R2 检查",
  },
];

export default async function AdminPage() {
  const adminUser = await requireAdminPageUser("/admin");
  const summary = await getAdminSummary();

  const metrics = [
    ["用户", summary.users.toLocaleString("zh-CN")],
    ["游戏", summary.games.toLocaleString("zh-CN")],
    ["版本", summary.gameVersions.toLocaleString("zh-CN")],
    ["Blob 数", summary.blobs.count.toLocaleString("zh-CN")],
    ["Blob 容量", formatBytes(summary.blobs.sizeBytes)],
    ["Core pack 数", summary.corePacks.count.toLocaleString("zh-CN")],
    ["Core pack 容量", formatBytes(summary.corePacks.sizeBytes)],
    ["导入任务", summary.importJobs.toLocaleString("zh-CN")],
    ["下载构建记录", summary.downloadBuilds.toLocaleString("zh-CN")],
  ];

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Prototype</p>
          <h1>最小可用存储模型</h1>
          <p className="subtitle">
            当前管理员：{adminUser.displayName}。页面展示 canonical storage
            计数，并提供上传权限审批入口。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin/users">
            用户审批
          </Link>
          <Link className="button" href="/">
            返回首页
          </Link>
        </div>
      </header>

      <section className="metric-grid" aria-label="存储摘要">
        {metrics.map(([label, value]) => (
          <article className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>原型 API</h2>
        <p>
          这些接口用于验证 D1/R2 绑定、对象幂等写入和 preflight 查询，不处理完整游戏
          ZIP。现在它们要求管理员或已批准上传者会话。
        </p>
        <div className="actions">
          {links.map((link) => (
            <a className="button" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </div>
        <pre className="code-block">{`PUT /api/blobs/{sha256}
PUT /api/core-packs/{sha256}
POST /api/imports/preflight`}</pre>
      </section>
    </main>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
