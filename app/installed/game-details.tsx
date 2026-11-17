import { useRef, useState, type ReactNode } from "react";
import { ChevronRight, Clock3, HardDrive, Save, X } from "lucide-react";
import * as Dialog from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { WorkHeader } from "@/app/components/work/work-page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { useWebPlayScreenshots } from "@/app/play/[workId]/web-play-screenshots";
import { formatBytes, formatDate } from "@/lib/format";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import type { LocalLibraryGame } from "./local-game-data";
import { SaveManager } from "./save-library";
import { useLocalCover } from "./use-local-cover";
import { ScreenshotGallery } from "./screenshot-gallery";

export type LibraryPanel = "overview" | "saves" | "screenshots";

export function GameDetails({ game, workId, initialPanel, active, onClose, onChanged, onClean, trigger }: {
  game: LocalLibraryGame;
  workId: number;
  initialPanel: LibraryPanel;
  active: boolean;
  onClose: () => void;
  onChanged: () => void;
  onClean: () => void;
  trigger: HTMLButtonElement | null;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
  const playHref = `/play/${workId}${navigationLocale ? `?${new URLSearchParams({ [UI_LOCALE_PARAM]: navigationLocale })}` : ""}`;
  const [panel, setPanel] = useState(initialPanel);
  const [activeScreenshot, setActiveScreenshot] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { screenshots, loading, remove } = useWebPlayScreenshots(workId, game.title);
  const cover = useLocalCover(game.coverBlobSha256);
  const installedBytes = game.installations.reduce((sum, row) => sum + row.installedBytes, 0);
  const installed = game.installations.some(row => row.status === "ready");

  async function removeScreenshots(ids: string[]) {
    await remove(ids);
    onChanged();
  }

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="bg-black/55" />
      <Dialog.Content aria-describedby={undefined}
        onEscapeKeyDown={event => { if (activeScreenshot !== null) { event.preventDefault(); setActiveScreenshot(null); } }}
        onCloseAutoFocus={event => { event.preventDefault(); trigger?.focus({ preventScroll: true }); }}
        className="local-library-dialog left-1/2 top-1/2 grid h-[min(760px,calc(100dvh-2rem))] w-[min(calc(100vw-2rem),1000px)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg">
        <div className="relative bg-background">
          <WorkHeader variant="dialog" title={<Dialog.Title asChild className="block pr-10 text-[length:inherit]"><span>{game.title}</span></Dialog.Title>} titleAs="h2" coverSrc={cover} />
          <Dialog.Close asChild><Button type="button" size="icon" variant="ghost" className="local-library-close absolute right-3 top-3 z-10" aria-label={t("installed.game.close")}><X aria-hidden /></Button></Dialog.Close>
        </div>
        <div ref={containerRef} className="relative grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="contents" inert={activeScreenshot !== null}>
            <div className="local-library-toolbar flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border bg-card px-5 py-4 sm:px-7">
              <Rm2kButton href={playHref} disabled={active}>{active ? t("installed.game.playing") : installed ? t("installed.game.play") : t("installed.game.downloadPlay")}</Rm2kButton>
              <span className="local-library-last-played flex flex-wrap items-center gap-2 text-xs text-muted"><Clock3 aria-hidden className="size-4" />{t("installed.game.lastPlayed")} <span className="tabular-nums">{formatDate(game.lastPlayedAt, { time: true, locale }) || "—"}</span></span>
            </div>
            <div className="local-library-scroll min-h-0 overflow-y-auto overscroll-contain px-5 py-3 sm:px-7">
              <div className="grid min-w-0 gap-7 min-[821px]:grid-cols-[minmax(0,1fr)_236px]">
                {panel === "saves" ? <section className="min-w-0" aria-label={t("installed.game.manageSaves")}>
                  <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{t("installed.game.localSaves")}</h2><Button type="button" variant="ghost" size="sm" onClick={() => setPanel("overview")}>{t("installed.game.backToShots")}</Button></div>
                  <SaveManager work={{ workId, title: game.title, playKey: game.playKey }} onChanged={onChanged} />
                </section> : <ScreenshotGallery screenshots={screenshots} loading={loading} title={game.title} initialManaging={initialPanel === "screenshots"} onDelete={removeScreenshots} containerRef={containerRef} activeId={activeScreenshot} onView={setActiveScreenshot} />}
                <aside className="local-library-sidebar grid content-start gap-4 max-[820px]:sm:grid-cols-2" aria-label={t("installed.game.recordsAndData")}>
                  <LibraryModule title={t("installed.game.playHistory")}>
                    <dl className="local-library-records"><dt>{t("installed.game.firstPlayed")}</dt><dd>{formatDate(game.firstPlayedAt ?? null, { locale }) || "—"}</dd><dt>{t("installed.game.launches")}</dt><dd>{game.launchCount == null ? "—" : t("installed.game.launchCount", { approx: game.firstPlayedAt === undefined ? "yes" : "no", count: game.launchCount })}</dd></dl>
                  </LibraryModule>
                  <LibraryModule title={t("installed.game.saves")} count={t("installed.game.saveCount", { count: game.saveNames.length })} footer={<Button className="local-library-module-action" type="button" variant="ghost" size="sm" onClick={() => setPanel("saves")}>{t("installed.game.manageSaves")}<ChevronRight aria-hidden /></Button>}>
                    {game.saveNames.length ? <ul className="divide-y divide-border">{game.saveNames.slice(0, 3).map(name => <li key={name} className="flex items-center gap-2 py-2 font-mono text-xs"><Save aria-hidden className="size-4 shrink-0 text-primary" /><span className="wrap-anywhere">{name}</span></li>)}{game.saveNames.length > 3 ? <li className="py-2 text-xs text-muted">{t("installed.game.remainingSaves", { count: game.saveNames.length - 3 })}</li> : null}</ul> : <p className="text-sm text-muted">{t("installed.game.emptySaves")}</p>}
                  </LibraryModule>
                  <LibraryModule title={t("installed.game.gameFiles")} footer={game.installations.length ? <Button className="local-library-module-action" type="button" variant="ghost" size="sm" disabled={active} onClick={onClean}>{t("installed.game.cleanFiles")}<ChevronRight aria-hidden /></Button> : undefined}>
                    <div className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-2 text-muted"><HardDrive aria-hidden className="size-4" />{t("installed.game.localUsage")}</span><span className="tabular-nums">{game.installations.length ? formatBytes(installedBytes) : t("installed.game.cleaned")}</span></div>
                  </LibraryModule>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function LibraryModule({ title, count, children, footer }: { title: string; count?: string; children: ReactNode; footer?: ReactNode }) {
  return <Card className="local-library-module overflow-hidden">
    <header className="flex h-10 items-center justify-between gap-2 px-3"><h3 className="text-sm font-semibold">{title}</h3>{count ? <span className="text-xs tabular-nums text-muted">{count}</span> : null}</header>
    <div className="px-3 pb-3">{children}</div>
    {footer ? <footer className="flex justify-end border-t border-border px-2 py-1">{footer}</footer> : null}
  </Card>;
}
