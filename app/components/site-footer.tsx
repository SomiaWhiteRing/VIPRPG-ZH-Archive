import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";

export function SiteFooter() {
  const pathname = useLocation().pathname;
  const footerRef = useRef<HTMLElement>(null);
  const hidden = pathname === "/discussions" || pathname.startsWith("/discussions/");

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const root = document.documentElement;
    let frame = 0;
    function measure() {
      frame = 0;
      if (!footer) return;
      const overlap = Math.max(0, window.innerHeight - footer.getBoundingClientRect().top);
      root.style.setProperty("--page-footer-occlusion", `${overlap}px`);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    observer.observe(footer);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      root.style.removeProperty("--page-footer-occlusion");
    };
  }, [hidden]);

  if (hidden) return null;
  return (
    <footer ref={footerRef} className="border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-8 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="m-0 text-primary-foreground/75">
            © 2026 VIPRPG.org
          </p>
          <nav aria-label="页脚导航" className="flex flex-wrap gap-4">
            <Link to="/about">关于</Link>
            <a href="https://status.viprpg.org/">运行状态</a>
            <a
              href="https://viprpg.org/discussions/1"
              rel="noreferrer"
              target="_blank"
            >
              反馈
            </a>
          </nav>
        </div>
        <nav aria-label="支持与闲谈" className="mt-4 flex justify-end gap-4 text-xs text-primary-foreground/60">
          <a href="https://afdian.com/a/whitering" rel="noreferrer" target="_blank">赛钱箱</a>
          <Link to="/sea">永恒之海</Link>
          <Link to="/material-search">大镜</Link>
        </nav>
      </div>
    </footer>
  );
}
