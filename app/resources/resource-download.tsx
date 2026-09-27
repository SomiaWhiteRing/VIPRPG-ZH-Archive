import { Button } from "@/app/components/ui/button";
import type { PublicResource, ResourceTarget } from "@/lib/resources";
import { ChevronDown, Download } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const serverTarget = (): ResourceTarget => "windows-x64";
const browserTarget = (): ResourceTarget =>
  /Android/i.test(navigator.userAgent) ? "android-universal" : "windows-x64";

export function ResourceDownload({ resource }: { resource: PublicResource }) {
  const target = useSyncExternalStore(subscribe, browserTarget, serverTarget);
  const current = resource.downloads.find((download) => download.target === target)
    ?? resource.downloads.find((download) => download.target === "windows-x64")
    ?? resource.downloads[0];
  if (!current) return <span className="text-sm text-muted">暂未提供下载</span>;

  const alternatives = resource.downloads.filter((download) => download.id !== current.id);
  const label = (target: ResourceTarget) => target === "windows-x64"
    ? resource.windows_button_label
    : resource.android_button_label;

  return (
    <div className="inline-flex items-stretch">
      <Button
        asChild
        size="sm"
        className={`min-h-10 sm:min-h-9 ${alternatives.length ? "rounded-r-none" : ""}`}
      >
        <a href={`/api/tool-artifacts/${current.id}/download`} target="_blank" rel="noopener noreferrer">
          <Download aria-hidden="true" />
          {label(current.target)}
        </a>
      </Button>
      {alternatives.length ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              size="sm"
              className="min-h-10 rounded-l-none border-l border-primary-foreground/30 px-2 sm:min-h-9"
              aria-label={`选择 ${resource.name} 的其他版本`}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 overflow-y-auto rounded-md border border-border bg-card p-1 text-foreground shadow-surface"
            >
              {alternatives.map((download) => (
                <DropdownMenu.Item key={download.id} asChild>
                  <a
                    href={`/api/tool-artifacts/${download.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-10 items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none data-highlighted:bg-muted/15"
                  >
                    <Download aria-hidden="true" className="size-4 shrink-0" />
                    {label(download.target)}
                  </a>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
    </div>
  );
}
