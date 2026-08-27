import Link from "next/link";

export function HomeTabs({ active }: { active: "all" | "original" }) {
  return (
    <nav className="my-6 flex gap-1 overflow-x-auto" aria-label="首页游戏分类">
      <Link className={tabClass(active === "all")} href="/">
        全部游戏
      </Link>
      <Link
        className={tabClass(active === "original")}
        href="/?tab=original"
      >
        本站原创
      </Link>
    </nav>
  );
}

function tabClass(active: boolean): string {
  return `inline-flex min-h-10 items-center border-b-2 px-4 text-sm font-bold ${
    active
      ? "border-primary text-primary"
      : "border-transparent text-muted hover:text-foreground"
  }`;
}
