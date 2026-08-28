import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { listGameWorks } from "@/lib/server/db/game-library";
import { HomeAnchors } from "@/app/components/home/home-tabs";
import { HomeGameCard } from "@/app/components/home/game-card";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [currentUser, recentWorks, recentOriginalWorks] = await Promise.all([
    getCurrentUserFromCookies(),
    listGameWorks({ limit: 9 }),
    listGameWorks({ limit: 9, isOriginal: true }),
  ]);

  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-12 sm:py-16">
      <section
        className="gap-8 border-b border-border py-6 pb-10 hidden md:grid"
        aria-label="作品发现"
      >
        <div>
          <h1 className="text-xl font-extrabold leading-[0.98] tracking-tight md:text-6xl">
            夢溢れるエターナラーを応援しています。
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-8 text-muted">
            欢迎来到VIPRPG中文保管库。
          </p>
        </div>
      </section>

      <HomeAnchors />

      <HomeGameSection
        description="最近更新的公开游戏。"
        id="recent-updates"
        moreHref="/games"
        title="最近更新"
        works={recentWorks}
      />

      <HomeGameSection
        className="mt-14"
        description="由作者亲自在本站发表的游戏。"
        id="recent-original"
        moreHref="/games?original=1"
        title="最近原创"
        works={recentOriginalWorks}
      />

      <section className="mt-14 scroll-mt-36" id="about-site" aria-labelledby="about-site-title">
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
          <p className="max-w-175 text-muted leading-7">
            VIPRPG.org 收录 VIPRPG 活动与社区相关的 RPG Maker 2000/2003 作品，
            提供清晰的游戏资料、当前快照、在线游玩和下载入口。这里优先展示真实作品内容，
            让你从浏览到开始游戏只需要几步。
          </p>
          <div className="grid gap-3 border-l-4 border-accent pl-5">
            <div>
              <strong>作品优先</strong>
              <span>封面、简介和游玩入口先于技术细节。</span>
            </div>
            <div>
              <strong>可追溯</strong>
              <span>历史快照保留在站内，公开页始终指向当前内容。</span>
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

function HomeGameSection({
  className,
  description,
  id,
  moreHref,
  title,
  works,
}: {
  className?: string;
  description: string;
  id: string;
  moreHref: string;
  title: string;
  works: Awaited<ReturnType<typeof listGameWorks>>;
}) {
  return (
    <section className={`${className ?? ""} scroll-mt-36`} id={id} aria-labelledby={`${id}-title`}>
        <div className="mb-5 flex items-end justify-between gap-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight" id={`${id}-title`}>
              {title}
            </h2>
            <p className="mt-1 text-muted">{description}</p>
          </div>
          <Link className="text-sm font-bold text-primary hover:text-accent" href={moreHref}>
            查看全部游戏 →
          </Link>
        </div>
        {works.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {works.map((work) => <HomeGameCard key={work.id} work={work} />)}
          </div>
        ) : (
          <p className="max-w-[700px] text-muted leading-7">目前还没有公开作品。</p>
        )}
      </section>
  );
}
