import { Button } from "@/app/components/ui/button";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

const itemClass = "flex min-h-8 w-full min-w-0 items-center justify-center rounded-md px-1 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const inactiveClass = "font-medium text-primary hover:bg-primary/10";
const activeClass = "bg-primary font-bold text-primary-foreground";
const monthClass = itemClass;

export function ReleasePeriodFilter({ period, currentYear, basePath, params }: {
  period: string;
  currentYear: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const initialYear = period ? Number(period.slice(0, 4)) : currentYear;
  // Anchor ten-year pages to the current year, not the selected year.
  const initialLastYear = currentYear + Math.ceil((initialYear - currentYear) / 10) * 10;
  const [lastYear, setLastYear] = useState(Math.min(9999, Math.max(10, initialLastYear)));
  const [rolling, setRolling] = useState(false);
  const animation = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(animation.current), []);

  function shiftYears(offset: number) {
    if (animation.current !== undefined) return;
    const target = Math.min(9999, Math.max(10, lastYear + offset));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLastYear(target);
      return;
    }
    setRolling(true);
    let year = lastYear;
    animation.current = setInterval(() => {
      year += Math.sign(target - year);
      setLastYear(year);
      if (year === target) {
        clearInterval(animation.current);
        animation.current = undefined;
        setRolling(false);
      }
    }, 40);
  }

  function href(value: string) {
    const search = new URLSearchParams();
    for (const [key, item] of Object.entries(params)) {
      if (item && key !== "page" && key !== "release") search.set(key, item);
    }
    if (value) search.set("release", value);
    return search.size ? `${basePath}?${search}` : basePath;
  }

  return <div className="grid w-full min-w-0 grid-cols-4 gap-x-1.5 gap-y-1" aria-label="选择发布年份" aria-busy={rolling}>
    <Button type="button" variant="ghost" className={`${itemClass} ${inactiveClass} py-0`} disabled={rolling || lastYear <= 10} onClick={() => shiftYears(-10)} aria-label="往年们，查看更早十年">往年们</Button>
    {Array.from({ length: 10 }, (_, index) => lastYear - 9 + index).map((year) => <ReleaseYear
      key={year}
      year={year}
      period={period}
      href={href}
      rolling={rolling}
    />)}
    <Button type="button" variant="ghost" className={`${itemClass} ${inactiveClass} py-0`} disabled={rolling || lastYear >= 9999} onClick={() => shiftYears(10)} aria-label="来年们，查看更晚十年">来年们</Button>
  </div>;
}

function ReleaseYear({ year, period, href, rolling }: {
  year: number;
  period: string;
  href: (value: string) => string;
  rolling: boolean;
}) {
  const [open, setOpen] = useState(false);
  const yearText = String(year).padStart(4, "0");
  const selected = period.slice(0, 4) === yearText;

  return <Popover.Root open={open && !rolling} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button
        type="button"
        variant="ghost"
        disabled={rolling}
        className={`${itemClass} ${selected ? `${activeClass} hover:bg-primary/90` : inactiveClass} py-0`}
        aria-label={`${year}年，选择全年或月份`}
      >{year}年</Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        aria-label={`${year}年发布月份`}
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={12}
        className="z-50 w-60 max-w-[calc(100vw-24px)] rounded-md border border-border bg-card p-1 shadow-surface outline-none"
      >
        <Link to={href(yearText)} onClick={() => setOpen(false)} aria-current={period === yearText ? "true" : undefined} className={`${monthClass} ${period === yearText ? activeClass : inactiveClass}`}>{year}年</Link>
        <div className="grid grid-cols-4 gap-x-1.5 gap-y-1">
          {Array.from({ length: 12 }, (_, index) => 12 - index).map((month) => {
            const value = `${yearText}-${String(month).padStart(2, "0")}`;
            return <Link key={month} to={href(value)} onClick={() => setOpen(false)} aria-current={period === value ? "true" : undefined} className={`${monthClass} ${period === value ? activeClass : inactiveClass}`}>{month}月</Link>;
          })}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
