import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canManageUsersRole, canUploadRole } from "@/lib/server/auth/roles";
import {
  getPublicArchiveCounts,
  listRecentlyUpdatedWorks,
} from "@/lib/server/db/public-overview";
import { formatNumber, formatDateOnly } from "@/lib/format";

export const dynamic = "force-dynamic";

const ENTRIES = [
  {
    href: "/games",
    icon: "🎮",
    title: "作品",
    description: "查找归档作品",
    countKey: "works",
  },
  {
    href: "/creators",
    icon: "🖌️",
    title: "作者与制作人员",
    description: "查看参与人员",
    countKey: "creators",
  },
  {
    href: "/characters",
    icon: "👥",
    title: "登场角色",
    description: "按角色找作品",
    countKey: "characters",
  },
  {
    href: "/tags",
    icon: "🏷️",
    title: "标签",
    description: "按标签找作品",
    countKey: "tags",
  },
  {
    href: "/series",
    icon: "📚",
    title: "系列",
    description: "查看系列归属",
    countKey: "series",
  },
] as const;

export default async function HomePage() {
  const [currentUser, counts, recent] = await Promise.all([
    getCurrentUserFromCookies(),
    getPublicArchiveCounts(),
    listRecentlyUpdatedWorks(8),
  ]);

  const canUpload = currentUser ? canUploadRole(currentUser.role) : false;
  const canAdmin = currentUser ? canManageUsersRole(currentUser.role) : false;

  return (
    <main>
      <section className="festival-hero" aria-label="站点入口">
        <p className="eyebrow">VIPRPG Chinese Archive</p>
        <h1>VIPRPG 中文归档</h1>
        <p>
          保存 VIPRPG 祭典相关的 RPG Maker 2000/2003 作品，可在线游玩与下载。
        </p>
        <form className="festival-hero-search" action="/games" method="get">
          <input
            aria-label="搜索作品、作者、角色、标签"
            name="q"
            placeholder="搜索作品 / 作者 / 角色 / 标签"
            type="search"
          />
          <button type="submit">搜索</button>
        </form>
      </section>

      <section className="festival-zone" aria-label="项目简介">
        <div className="notice-pane">
          <h2>收录范围</h2>
          <p>
            收录 VIPRPG 祭典相关的 RPG Maker 2000/2003 作品，包括原版、汉化版、修正版与活动投稿。
          </p>
          <p>
            技术细节与保存边界见 <Link href="/about">关于本归档</Link>。
          </p>
        </div>
      </section>

      <section className="festival-zone" aria-label="主要入口">
        <div className="festival-zone-heading">
          <h2>浏览板</h2>
          <Link href="/games">查看全部作品 →</Link>
        </div>
        <div className="entry-grid">
          {ENTRIES.map((entry) => {
            const count = counts[entry.countKey];
            return (
              <Link key={entry.href} className="entry-card" href={entry.href}>
                <span className="entry-card-icon" aria-hidden>
                  {entry.icon}
                </span>
                <h3>{entry.title}</h3>
                <p>{entry.description}</p>
                <span className="entry-card-count">
                  {formatNumber(count)} 条
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="festival-zone" aria-label="参与贡献">
        <div className="festival-zone-heading">
          <h2>参与贡献</h2>
        </div>
        <div className="contribute-grid">
          {!currentUser ? (
            <>
              <Link className="entry-card" href="/login">
                <span className="entry-card-icon" aria-hidden>🔑</span>
                <h3>登录</h3>
                <p>查看站内信与账户状态。</p>
              </Link>
              <Link className="entry-card" href="/register">
                <span className="entry-card-icon" aria-hidden>📝</span>
                <h3>注册账号</h3>
                <p>注册后可申请上传权限。</p>
              </Link>
            </>
          ) : null}
          {currentUser && !canUpload ? (
            <Link className="entry-card" href="/me">
              <span className="entry-card-icon" aria-hidden>📨</span>
              <h3>申请上传权限</h3>
              <p>上传需要上传者权限，可在「我的账户」申请。</p>
            </Link>
          ) : null}
          {currentUser && canUpload ? (
            <>
              <Link className="entry-card" href="/upload">
                <span className="entry-card-icon" aria-hidden>📤</span>
                <h3>上传归档</h3>
                <p>在浏览器内直接导入本地游戏目录，只上传缺少的文件。</p>
              </Link>
              <Link className="entry-card" href="/upload/tasks">
                <span className="entry-card-icon" aria-hidden>🧾</span>
                <h3>我的导入任务</h3>
                <p>查看导入进度与结果。</p>
              </Link>
            </>
          ) : null}
          {canAdmin ? (
            <Link className="entry-card" href="/admin">
              <span className="entry-card-icon" aria-hidden>🛠️</span>
              <h3>管理控制台</h3>
              <p>处理内容、用户与维护事项。</p>
            </Link>
          ) : null}
        </div>
      </section>

      <section className="festival-zone" aria-label="最近更新">
        <div className="festival-zone-heading">
          <h2>最近更新</h2>
          <Link href="/games">查看全部作品 →</Link>
        </div>
        <div className="notice-pane">
          {recent.length > 0 ? (
            <ul className="recent-update-list">
              {recent.map((item) => (
                <li key={item.slug}>
                  <Link href={`/games/${item.slug}`}>{item.title}</Link>
                  <time dateTime={item.updatedAt}>
                    {formatDateOnly(item.updatedAt)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-line">还没有公开作品。</p>
          )}
        </div>
      </section>
    </main>
  );
}
