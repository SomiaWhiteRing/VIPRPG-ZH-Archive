import { useRef, useState, type ReactNode } from "react";
import { ChevronRight, Clock3, HardDrive, Save, X } from "lucide-react";
import * as Dialog from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { WorkHeader } from "@/app/components/work/work-page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { useWebPlayScreenshots } from "@/app/play/[workId]/web-play-screenshots";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
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
          <Dialog.Close asChild><Button type="button" size="icon" variant="ghost" className="local-library-close absolute right-3 top-3 z-10" aria-label="关闭游戏详情"><X aria-hidden /></Button></Dialog.Close>
        </div>
        <div ref={containerRef} className="relative grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="contents" inert={activeScreenshot !== null}>
            <div className="local-library-toolbar flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border bg-card px-5 py-4 sm:px-7">
              <Rm2kButton href={`/play/${workId}`} disabled={active}>{active ? "正在游玩" : installed ? "开始游戏" : "下载并游玩"}</Rm2kButton>
              <span className="local-library-last-played flex flex-wrap items-center gap-2 text-xs text-muted"><Clock3 aria-hidden className="size-4" />最近游玩 <span className="tabular-nums">{formatDate(game.lastPlayedAt, { time: true }) || "—"}</span></span>
            </div>
            <div className="local-library-scroll min-h-0 overflow-y-auto overscroll-contain px-5 py-3 sm:px-7">
              <div className="grid min-w-0 gap-7 min-[821px]:grid-cols-[minmax(0,1fr)_236px]">
                {panel === "saves" ? <section className="min-w-0" aria-label="存档管理">
                  <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">本地存档</h2><Button type="button" variant="ghost" size="sm" onClick={() => setPanel("overview")}>返回截图</Button></div>
                  <SaveManager work={{ workId, title: game.title, playKey: game.playKey }} onChanged={onChanged} />
                </section> : <ScreenshotGallery screenshots={screenshots} loading={loading} title={game.title} initialManaging={initialPanel === "screenshots"} onDelete={removeScreenshots} containerRef={containerRef} activeId={activeScreenshot} onView={setActiveScreenshot} />}
                <aside className="local-library-sidebar grid content-start gap-4 max-[820px]:sm:grid-cols-2" aria-label="个人记录与本地资料">
                  <LibraryModule title="游玩记录">
                    <dl className="local-library-records"><dt>初次游玩</dt><dd>{formatDate(game.firstPlayedAt ?? null) || "—"}</dd><dt>启动次数</dt><dd>{game.launchCount == null ? "—" : `${game.firstPlayedAt === undefined ? "≥ " : ""}${formatNumber(game.launchCount)} 次`}</dd></dl>
                  </LibraryModule>
                  <LibraryModule title="存档" count={`${game.saveNames.length} 个`} footer={<Button className="local-library-module-action" type="button" variant="ghost" size="sm" onClick={() => setPanel("saves")}>管理存档<ChevronRight aria-hidden /></Button>}>
                    {game.saveNames.length ? <ul className="divide-y divide-border">{game.saveNames.slice(0, 3).map(name => <li key={name} className="flex items-center gap-2 py-2 font-mono text-xs"><Save aria-hidden className="size-4 shrink-0 text-primary" /><span className="wrap-anywhere">{name}</span></li>)}{game.saveNames.length > 3 ? <li className="py-2 text-xs text-muted">剩余 {game.saveNames.length - 3} 个</li> : null}</ul> : <p className="text-sm text-muted">没有本地存档。</p>}
                  </LibraryModule>
                  <LibraryModule title="游戏文件" footer={game.installations.length ? <Button className="local-library-module-action" type="button" variant="ghost" size="sm" disabled={active} onClick={onClean}>清理游戏文件<ChevronRight aria-hidden /></Button> : undefined}>
                    <div className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-2 text-muted"><HardDrive aria-hidden className="size-4" />本地占用</span><span className="tabular-nums">{game.installations.length ? formatBytes(installedBytes) : "已清理"}</span></div>
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
