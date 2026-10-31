import { Button } from "@/app/components/ui/button";
import * as Popover from "@/app/components/ui/popover";
import { isAndroidClient } from "@/lib/browser/client-environment";
import type { PublicResource, ResourceTarget } from "@/lib/resources";
import { ChevronDown, Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useSyncExternalStore } from "react";

const subscribe = () => () => {};
const serverTarget = (): ResourceTarget => "windows-x64";
const browserTarget = (): ResourceTarget =>
  /Android/i.test(navigator.userAgent) ? "android-universal" : "windows-x64";
const desktopQuery = "(hover: hover) and (pointer: fine)";
const serverDesktop = () => false;
const browserDesktop = () => !isAndroidClient() && window.matchMedia(desktopQuery).matches;
const subscribeDesktop = (onChange: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

export function ResourceDownload({ resource }: { resource: PublicResource }) {
  const target = useSyncExternalStore(subscribe, browserTarget, serverTarget);
  const desktop = useSyncExternalStore(subscribeDesktop, browserDesktop, serverDesktop);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = resource.downloads.find((download) => download.target === target)
    ?? resource.downloads.find((download) => download.target === "windows-x64")
    ?? resource.downloads[0];
  if (!current) return <span className="text-sm text-muted">暂未提供下载</span>;

  const alternatives = resource.downloads.filter((download) => download.id !== current.id);
  const android = resource.downloads.find((download) => download.target === "android-universal");
  const qrUrl = desktop && android
    ? new URL(`/api/tool-artifacts/${android.id}/download`, window.location.origin).href
    : null;
  const expandable = alternatives.length > 0 || qrUrl !== null;
  const label = (target: ResourceTarget) => target === "windows-x64"
    ? resource.windows_button_label
    : resource.android_button_label;

  return (
    <div className="inline-flex items-stretch">
      <Button
        asChild
        size="sm"
        className={`min-h-10 sm:min-h-9 ${expandable ? "rounded-r-none" : ""}`}
      >
        <a href={`/api/tool-artifacts/${current.id}/download`} target="_blank" rel="noopener noreferrer">
          <Download aria-hidden="true" />
          {label(current.target)}
        </a>
      </Button>
      {expandable ? (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button
              ref={triggerRef}
              type="button"
              size="sm"
              className="min-h-10 rounded-l-none border-l border-primary-foreground/30 px-2 sm:min-h-9 [&[data-state=open]>svg]:rotate-180"
              aria-label={`${resource.name} 下载方式`}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </Popover.Trigger>
          <Popover.Portal anchorRef={triggerRef}>
            <Popover.Content
              aria-label={`${resource.name} 下载方式`}
              align="end"
              sideOffset={4}
              collisionPadding={16}
              className="z-50 max-h-[var(--radix-popover-content-available-height)] w-52 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-border bg-card p-1 text-foreground shadow-surface"
            >
              {alternatives.map((download) => (
                <Popover.Close key={download.id} asChild>
                  <a
                    href={`/api/tool-artifacts/${download.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-10 items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-muted/15 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <Download aria-hidden="true" className="size-4 shrink-0" />
                    {label(download.target)}
                  </a>
                </Popover.Close>
              ))}
              {qrUrl ? (
                <div className={`p-3 ${alternatives.length ? "mt-1 border-t border-border" : ""}`}>
                  <QRCodeSVG
                    value={qrUrl}
                    size={160}
                    level="M"
                    marginSize={4}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    title={`${resource.name} Android 下载二维码`}
                    className="mx-auto size-40 max-w-full"
                  />
                  <p className="mt-2 text-center text-sm text-muted">手机扫码下载</p>
                </div>
              ) : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </div>
  );
}
