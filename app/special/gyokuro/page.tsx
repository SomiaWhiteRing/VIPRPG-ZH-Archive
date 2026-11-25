import { data, useLoaderData, useNavigation, useSearchParams, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { readGyokuroStats } from "@/app/.server/db/gyokuro-stats";
import { runtimeContext } from "@/app/.server/router-context";
import type { PageLayoutHandle } from "@/app/components/use-page-layout";
import { gyokuroStatsPath, productionGyokuroJapaneseWork, productionNetplayHongKongWork, productionNetplaySiteOrigin } from "@/lib/archive/netplay-ingress";
import { formatDateKey } from "@/lib/format";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { DEFAULT_USER_AVATAR_SRC, getUserAvatarSrc } from "@/lib/user-profile";
import { loadGyokuroFont, type BitmapFont } from "./bitmap-font";
import { chartHeight, chartPercent, chartWidth, colors, drawGyokuroChart, layoutChartHeader, pixelPainter } from "./chart";
import { canvasHit, drawHit, handleCanvasKey, layoutPage, type DateFilter, type DrawerKind, type ScopeLabels } from "./controls";
import { GyokuroDrawer } from "./drawer";
import { defaultStatsStart, fighters, type Scope } from "./model";

const DAY = 86_400_000;
const SITE_UTC_OFFSET = 8 * 60 * 60 * 1000;
const defaultFrom = { value: defaultStatsStart, milliseconds: Date.parse(`${defaultStatsStart}T00:00:00+08:00`) };

export const handle: PageLayoutHandle = {
  layout: { hideSiteHeader: true, hideSiteFooter: true, hideBackToTop: true },
};

export function headers() { return { "Cache-Control": "private, no-store" }; }

function parseDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const utc = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) return null;
  return { value, milliseconds: utc.getTime() - SITE_UTC_OFFSET };
}

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const user = await getCurrentUser(runtime);
  const params = new URL(args.request.url).searchParams;
  let from = parseDay(params.get("from"));
  let to = parseDay(params.get("to"));
  if (from && to && from.milliseconds > to.milliseconds) [from, to] = [to, from];
  from ??= defaultFrom;
  return data({
    filter: { from: from.value, to: to?.value ?? "" },
    viewer: user ? { displayName: user.displayName, avatarSrc: getUserAvatarSrc(user.avatarBlobSha256) } : null,
    ...await readGyokuroStats(runtime, user?.id ?? null, from.milliseconds, to ? to.milliseconds + DAY : null),
  }, { headers: headers() });
}

export const meta: MetaFunction = ({ location, matches, error }) => {
  const locale = pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "gyokuro.title") }, error, locale);
};

export default function GyokuroStatsPage() {
  const { filter, all, personal, viewer } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
  const [selectedScope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<"usage" | "win">("usage");
  const [drawer, setDrawer] = useState<{ kind: DrawerKind; keyboard: boolean } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [atlas, setAtlas] = useState<HTMLImageElement | null>(null);
  const [font, setFont] = useState<BitmapFont | null>(null);
  const [loadedAvatar, setLoadedAvatar] = useState<{ src: string; image: HTMLImageElement } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setAtlas(image);
    image.src = "/assets/gyokuro-stats/atlas-v1.png";
    let mounted = true;
    void loadGyokuroFont().then(loaded => {
      if (mounted) setFont(() => loaded);
    }, () => {});
    return () => {
      mounted = false;
      image.onload = null;
    };
  }, []);

  const avatarSrc = viewer?.avatarSrc;
  useEffect(() => {
    if (!avatarSrc) return;
    const image = new Image();
    image.onload = () => setLoadedAvatar({ src: avatarSrc, image });
    if (avatarSrc !== DEFAULT_USER_AVATAR_SRC) {
      image.onerror = () => {
        image.onerror = null;
        image.src = DEFAULT_USER_AVATAR_SRC;
      };
    }
    image.src = avatarSrc;
    return () => { image.onload = image.onerror = null; };
  }, [avatarSrc]);

  const name = viewer?.displayName ?? "";
  const avatar = loadedAvatar?.src === avatarSrc ? loadedAvatar?.image ?? null : null;
  const scope = personal && viewer ? selectedScope : "all";
  const scopeLabels: ScopeLabels = {
    all: { name: t("gyokuro.all"), suffix: "", avatar: false },
    mine: { name, suffix: "", avatar: true },
    others: { name, suffix: t("gyokuro.exclusionSuffix"), avatar: true },
  };
  const scopeLabel = scopeLabels[scope];
  const scopeText = scopeLabel.name + scopeLabel.suffix;
  const stats = scope === "all" ? all : personal?.[scope] ?? all;
  const busy = navigation.location?.pathname === gyokuroStatsPath;
  const denominator = stats.rows.reduce((total, row) => total + row.count, 0);
  const played = new Map(stats.rows.map(row => [row.icon, row]));
  const rows = fighters.map((_, icon) => played.get(icon) ?? { icon, count: 0, wins: 0 }).sort((a, b) =>
    (sort === "win" && a.count && b.count ? b.wins * a.count - a.wins * b.count : 0) || b.count - a.count || a.icon - b.icon,
  ).map(row => ({
    icon: row.icon,
    usage: denominator ? row.count / denominator : 0,
    win: row.count ? row.wins / row.count : 0,
    count: t("gyokuro.count", { count: row.count }),
    record: t("gyokuro.record", { wins: row.wins, losses: row.count - row.wins }),
  }));
  const usageMax = scope === "mine" ? 100 : Math.max(15, Math.ceil(Math.max(...rows.map(row => row.usage), 0) * 20) * 5);
  const firstDay = filter.from;
  const lastDay = filter.to || (stats.latest === null ? "" : formatDateKey(new Date(stats.latest)));
  const sharedYear = firstDay.slice(0, 4) === lastDay.slice(0, 4);
  const labels = {
    title: t("gyokuro.chart"),
    sort: t(sort === "usage" ? "gyokuro.usageOrder" : "gyokuro.winOrder"),
    matches: t("gyokuro.matches", { count: stats.matches.toLocaleString(locale) }),
    dates: [firstDay, lastDay].filter(Boolean).map(day => day.slice(sharedYear ? 5 : 0).replaceAll("-", "/")).join("-"),
    fighter: t("gyokuro.fighter"),
    usage: t("gyokuro.usage"),
    win: t("gyokuro.win"),
  };
  const header = font ? layoutChartHeader(labels, scopeLabel, font) : null;
  const { hits, height } = header ? layoutPage(t, {
    personal: !!(personal && viewer), sort: labels.sort, dates: labels.dates, scope: scopeText, header,
    rows: rows.length, canExport: !!atlas && (!scopeLabel.avatar || !!avatar),
  }) : { hits: [], height: chartHeight(rows.length) + 42 };

  useLayoutEffect(() => {
    const view = canvas.current;
    if (!view) return;
    view.style.setProperty("--gyokuro-aspect", String(view.width / view.height));
    const ctx = view.getContext("2d");
    if (!ctx || !atlas || !header || !font) return;
    drawGyokuroChart(ctx, atlas, labels, rows, usageMax, header, avatar, font, focus);
    const painter = pixelPainter(ctx, font);
    const chartEnd = chartHeight(rows.length, header.extra);
    painter.rect(0, chartEnd, chartWidth, view.height - chartEnd, colors.ink);
    for (const hit of hits) {
      if (hit.id === "game" || hit.id === "export") drawHit(painter, hit, hit.id === focus);
    }
  });

  function query(next: DateFilter) {
    setDrawer(null);
    if (next.from === filter.from && next.to === filter.to) return;
    const params = new URLSearchParams(searchParams);
    if (next.from && next.from !== defaultStatsStart) params.set("from", next.from);
    else params.delete("from");
    if (next.to) params.set("to", next.to);
    else params.delete("to");
    setSearchParams(params, { preventScrollReset: true });
  }

  function activate(id: string, keyboard = false) {
    switch (id) {
      case "scope": case "dates":
        setDrawer({ kind: id, keyboard });
        break;
      case "sort":
        setSort(sort === "usage" ? "win" : "usage");
        break;
      case "game": {
        const work = locale === "zh-Hans" ? productionNetplayHongKongWork : productionGyokuroJapaneseWork;
        const destination = new URL(`/games/${work}`, productionNetplaySiteOrigin);
        if (navigationLocale) destination.searchParams.set(UI_LOCALE_PARAM, navigationLocale);
        window.location.assign(destination);
        break;
      }
      case "export": {
        if (!atlas || !header || !font) break;
        const png = document.createElement("canvas");
        png.width = chartWidth;
        png.height = chartHeight(rows.length, header.extra);
        const ctx = png.getContext("2d");
        if (!ctx) break;
        drawGyokuroChart(ctx, atlas, labels, rows, usageMax, header, avatar, font);
        const link = document.createElement("a");
        link.download = `gyokuro-${sort}-${firstDay}-${lastDay}.png`;
        link.href = png.toDataURL("image/png");
        link.click();
        break;
      }
    }
  }

  return (
    <main className="min-h-screen bg-[#0b101d]">
      <h1 className="sr-only">{t("gyokuro.title")}</h1>
      <canvas
        ref={canvas} width={chartWidth} height={height} tabIndex={0} data-gyokuro-chart
        className="mx-auto block h-auto w-full [image-rendering:pixelated] pointer-fine:w-[640px] pointer-fine:supports-[width:round(down,320px,320px)]:w-[max(640px,round(down,min(100%,calc(100dvh*var(--gyokuro-aspect,0))),320px))]"
        aria-label={t("gyokuro.title")} aria-describedby="gyokuro-canvas-description"
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setFocus(hits[0]?.id ?? null);
        }}
        onBlur={() => setFocus(null)}
        onKeyDown={event => handleCanvasKey(event, hits, focus, setFocus, id => activate(id, true))}
        onPointerMove={(event) => {
          event.currentTarget.style.cursor = canvasHit(hits, event.currentTarget, event.clientX, event.clientY) ? "pointer" : "";
        }}
        onClick={(event) => {
          const hit = canvasHit(hits, event.currentTarget, event.clientX, event.clientY);
          if (hit) {
            setFocus(null);
            activate(hit.id);
          }
        }}
      />
      <div className="sr-only" id="gyokuro-canvas-description">
        <p>{t("gyokuro.board")}</p>
        <p aria-live="polite">{hits.find(hit => hit.id === focus)?.label}</p>
        <p>{[labels.matches, scopeText, firstDay, lastDay, labels.sort].filter(Boolean).join(" / ")}</p>
        <ul>{rows.map(row => <li key={row.icon}>{t("gyokuro.row", {
          id: fighters[row.icon], usage: chartPercent(row.usage), win: chartPercent(row.win), record: row.record,
        })}</li>)}</ul>
      </div>
      {drawer && font ? <GyokuroDrawer
        kind={drawer.kind} filter={filter} latest={lastDay || formatDateKey(new Date(all.latest ?? Date.now()))} busy={busy}
        scopeLabels={scopeLabels} font={font} avatar={avatar}
        close={() => setDrawer(null)}
        restore={() => {
          canvas.current?.focus({ preventScroll: true });
          setFocus(drawer.keyboard ? drawer.kind : null);
        }}
        onScope={next => { setScope(next); setDrawer(null); }}
        onDates={query}
      /> : null}
    </main>
  );
}
