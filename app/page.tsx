import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canManageUsersRole, canUploadRole } from "@/lib/server/auth/roles";
import {
  getPublicArchiveCounts,
  listRecentlyUpdatedWorks,
} from "@/lib/server/db/public-overview";

export const dynamic = "force-dynamic";

const ENTRIES = [
  {
    href: "/games",
    icon: "🎮",
    title: "作品",
    description: "按标题、引擎、标签、角色筛选已归档的 RPG Maker 2000/2003 游戏。",
    countKey: "works",
  },
  {
    href: "/creators",
    icon: "🖌️",
    title: "作者与制作人员",
    description: "按作者、汉化、校对、修图、整理人员浏览参与作品。",
    countKey: "creators",
  },
  {
    href: "/characters",
    icon: "👥",
    title: "登场角色",
    description: "按角色反查其出现过的作品，独立于普通标签。",
    countKey: "characters",
  },
  {
    href: "/tags",
    icon: "🏷️",
    title: "标签",
    description: "按风格、玩法、来源筛选作品，与系列分开管理。",
    countKey: "tags",
  },
  {
    href: "/series",
    icon: "📚",
    title: "系列",
    description: "查看正篇、外传、合集成员、同世界观作品的归属。",
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
          收录、整理、保存以 VIPRPG 祭典为中心的 RPG Maker 2000/2003 中文化作品。
          可在线游玩、下载归档、查阅作者与角色资料。
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
          <h2>这是什么</h2>
          <p>
            VIPRPG 中文归档把社区流转中的 VIPRPG 系作品（含汉化版、原版、修正版、活动投稿等）
            按「作品 → 发布版本 → 归档快照」的结构整理，并尽可能保留原文件结构与元信息。
            浏览者可以在线游玩支持的作品、下载完整 ZIP，或按角色、标签、系列回溯整个发布脉络。
          </p>
          <p>
            想了解技术原理（去重存储、浏览器预索引导入、Cloudflare D1/R2）和保存边界，
            请阅读 <Link href="/about">关于本归档</Link>。
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
                <p>已有账号请登录后访问站内信、申请上传权限。</p>
              </Link>
              <Link className="entry-card" href="/register">
                <span className="entry-card-icon" aria-hidden>📝</span>
                <h3>注册账号</h3>
                <p>注册后可以申请成为上传者、参与归档贡献。</p>
              </Link>
            </>
          ) : null}
          {currentUser && !canUpload ? (
            <Link className="entry-card" href="/me">
              <span className="entry-card-icon" aria-hidden>📨</span>
              <h3>申请上传权限</h3>
              <p>
                当前账户为普通用户。在「我的账户」中提交申请，管理员会通过站内信回复。
              </p>
            </Link>
          ) : null}
          {currentUser && canUpload ? (
            <>
              <Link className="entry-card" href="/upload">
                <span className="entry-card-icon" aria-hidden>📤</span>
                <h3>上传归档</h3>
                <p>在浏览器内完成扫描、去重、preflight、commit，无需上传完整 ZIP。</p>
              </Link>
              <Link className="entry-card" href="/upload/tasks">
                <span className="entry-card-icon" aria-hidden>🧾</span>
                <h3>我的导入任务</h3>
                <p>查看正在进行和最近完成的导入任务、错误信息与状态。</p>
              </Link>
            </>
          ) : null}
          {canAdmin ? (
            <Link className="entry-card" href="/admin">
              <span className="entry-card-icon" aria-hidden>🛠️</span>
              <h3>管理控制台</h3>
              <p>进入管理仪表盘，处理待办、内容审核、维护与危险操作。</p>
            </Link>
          ) : null}
        </div>
      </section>

      <section className="festival-zone" aria-label="最近更新">
        <div className="festival-zone-heading">
          <h2>最近更新</h2>
          <Link href="/games">前往作品资料库 →</Link>
        </div>
        <div className="notice-pane">
          {recent.length > 0 ? (
            <ul className="recent-update-list">
              {recent.map((item) => (
                <li key={item.slug}>
                  <Link href={`/games/${item.slug}`}>{item.title}</Link>
                  <time dateTime={item.updatedAt}>
                    {formatDate(item.updatedAt)}
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

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatDate(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
  }).format(date);
}
