import { Link, useLocation } from "react-router";

export function SiteFooter() {
  const pathname = useLocation().pathname;
  if (pathname === "/discussions" || pathname.startsWith("/discussions/"))
    return null;
  return (
    <footer className="border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto flex w-[min(1180px,calc(100vw-2rem))] flex-wrap items-center justify-between gap-4 py-8 text-sm">
        <p className="m-0 text-primary-foreground/75">
          VIPRPG.org · RPG Maker 作品
        </p>
        <nav aria-label="页脚导航" className="flex flex-wrap gap-4">
          <Link to="/about">关于</Link>
          <Link to="/api/health">运行状态</Link>
          <a
            href="https://github.com/SomiaWhiteRing/VIPRPG-ZH-Archive/issues"
            rel="noreferrer"
            target="_blank"
          >
            反馈
          </a>
        </nav>
      </div>
    </footer>
  );
}
