import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p>VIPRPG 中文归档 · RPG Maker 2000/2003</p>
        <nav aria-label="页脚导航">
          <Link href="/about">关于</Link>
          <Link href="/api/health">运行状态</Link>
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
