import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { listGameWorks } from "@/lib/server/db/game-library";
import { HomeTabs } from "@/app/components/home/home-tabs";
import { HomeGameCard } from "@/app/components/home/game-card";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [currentUser, works] = await Promise.all([getCurrentUserFromCookies(), listGameWorks({ limit: 9 })]);

  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-12 sm:py-16">
      <section
        className="grid gap-8 border-b border-border py-6 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:items-end"
        aria-label="作品发现"
      >
        <div>
          <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-accent">VIPRPG / PLAY SPACE</p>
          <h1 className="text-4xl font-extrabold leading-[0.98] tracking-tight md:text-6xl">
            发现下一款
            <br />
            想玩的 RPG。
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-8 text-muted">
            浏览 VIPRPG 社区里的 RPG Maker 作品，进入详情、在线游玩或下载。
          </p>
        </div>
        <form className="flex gap-2" action="/search" method="get">
          <Label className="sr-only" htmlFor="home-search">
            搜索作品
          </Label>
          <Input
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
            id="home-search"
            name="q"
            placeholder="搜索作品、作者、标签或角色"
            type="search"
          />
          <Rm2kButton type="submit">搜索</Rm2kButton>
        </form>
      </section>

      <HomeTabs />

      <section className="scroll-mt-36" id="recent-updates" aria-labelledby="recent-updates-title">
        <div className="mb-5 flex items-end justify-between gap-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight" id="recent-updates-title">
              最近更新
            </h2>
            <p className="mt-1 text-muted">最近有新版本或新内容的作品。</p>
          </div>
          <Link className="text-sm font-bold text-primary hover:text-accent" href="/games">
            查看全部游戏 →
          </Link>
        </div>
        {works.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {works.map((work) => (
              <HomeGameCard key={work.id} work={work} />
            ))}
          </div>
        ) : (
          <p className="max-w-[700px] text-muted leading-7">目前还没有公开作品。</p>
        )}
      </section>

      <section className="scroll-mt-36" id="about-site" aria-labelledby="about-site-title">
        <div className="mb-5 flex items-end justify-between gap-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight" id="about-site-title">
              关于本站
            </h2>
            <p className="mt-1 text-muted">一个面向玩家的 VIPRPG 作品空间。</p>
          </div>
          <Link className="text-sm font-bold text-primary hover:text-accent" href="/about">
            了解更多 →
          </Link>
        </div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)]">
          <p className="max-w-[700px] text-muted leading-7">
            VIPRPG.org 收录 VIPRPG 活动与社区相关的 RPG Maker 2000/2003 作品，
            提供清晰的作品资料、版本选择、在线游玩和下载入口。这里优先展示真实作品内容，
            让你从浏览到开始游戏只需要几步。
          </p>
          <div className="grid gap-3 border-l-4 border-accent pl-5">
            <div>
              <strong>作品优先</strong>
              <span>封面、简介和游玩入口先于技术细节。</span>
            </div>
            <div>
              <strong>可追溯</strong>
              <span>不同发布版本独立展示，来源和变更保持清晰。</span>
            </div>
            <div>
              <strong>一起补充</strong>
              <span>{currentUser ? "可以从账户入口查看你的贡献状态。" : "登录后可以申请上传权限。"}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
