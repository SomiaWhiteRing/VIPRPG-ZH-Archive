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
      <div className="mx-auto flex w-[min(1180px,calc(100vw-2rem))] flex-wrap items-center justify-between gap-4 py-8 text-sm">
        <p className="m-0 text-primary-foreground/75">
          © 2026 VIPRPG.org
        </p>
        <nav aria-label="页脚导航" className="flex flex-wrap gap-4">
          <Link to="/about">关于</Link>
          <a href="/api/health">运行状态</a>
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
