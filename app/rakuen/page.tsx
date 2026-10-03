import { listRakuenPages } from "@/app/.server/db/rakuen";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Timestamp } from "@/app/components/ui/timestamp";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import { TopicTags } from "@/app/discussions/shared";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type LoaderFunctionArgs, type MetaFunction, Link, useLoaderData } from "react-router";

import { useRouterNavigationGuard } from "@/app/components/ui/use-navigation-guard";

const sources = {
  all: "全部",
  topic: "讨论版",
  work: "作品",
  creator: "作者",
  character: "角色",
};

const desktopQuery = "(min-width: 64rem)";
function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const desktopSnapshot = () => window.matchMedia(desktopQuery).matches;
const serverSnapshot = () => false;

function hasPendingContent(frame: HTMLIFrameElement | null) {
  try {
    const document = frame?.contentDocument;
    const window = frame?.contentWindow;
    if (!document || !window) return false;
    // Router navigation in the parent must also honor the child's unload guard.
    const event = document.createEvent("Event");
    event.initEvent("beforeunload", false, true);
    return !window.dispatchEvent(event);
  } catch {
    return false;
  }
}

export async function loader(args: LoaderFunctionArgs) {
  const url = new URL(args.request.url);
  return listRakuenPages(
    args.context.get(runtimeContext),
    url.searchParams.get("type") ?? "all",
    Number(url.searchParams.get("page") ?? 1),
  );
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "超展开", page: loaderData?.page }, error);

export default function RakuenPage() {
  const { items, type, page, pageSize, total } = useLoaderData<typeof loader>();
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, serverSnapshot);
  const [frameCreated, setFrameCreated] = useState(false);
  const [activePath, setActivePath] = useState("");
  const listRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const confirm = useConfirm();
  useRouterNavigationGuard(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && hasPendingContent(frameRef.current),
    () => confirm("当前页面有未提交的内容或进行中的操作，确定离开？"),
  );

  useEffect(() => {
    if (desktop) setFrameCreated(true);
  }, [desktop]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [type, page]);

  return (
    <main className="rakuen-page" aria-labelledby="rakuen-heading">
      <section className="min-w-0 lg:min-h-0 lg:overflow-y-auto" ref={listRef} aria-label="最新活动">
        <div className="sticky top-[var(--site-header-height,3.5rem)] z-10 border-b border-border bg-background px-4 pb-2 pt-3 lg:top-0">
          <nav className="flex flex-wrap gap-1 text-sm" aria-label="活动来源">
            {Object.entries(sources).map(([value, label]) => (
              <Link
                key={value}
                to={value === "all" ? "/rakuen" : `/rakuen?type=${value}`}
                prefetch="none"
                aria-current={type === value ? "page" : undefined}
                className={`rounded px-2.5 py-1 ${type === value ? "bg-primary/10 font-semibold text-primary" : "text-muted hover:bg-muted/10"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {items.length ? (
          <ul className="divide-y divide-border/50">
            {items.map((item) => (
              <li
                key={`${item.kind}:${item.id}`}
                className={`flex items-start gap-3 pl-2.5 py-1 hover:bg-muted/10 ${activePath === item.entryHref ? "bg-primary/5" : "even:bg-muted/5"}`}
              >
                {/* ponytail: native frame targets keep the original URL and context menu. */}
                <a
                  href={item.href}
                  target={desktop ? "rakuen-content" : undefined}
                  aria-label={item.title}
                  className="block size-8 shrink-0"
                >
                  {item.kind === "topic" ? (
                    <UserAvatar avatarBlobSha256={item.avatarBlobSha256} displayName={item.imageName} size={48} />
                  ) : item.kind === "work" ? (
                    <span className="relative block size-8 overflow-hidden rounded-md border border-border bg-muted/10">
                      <WorkThumbnail
                        blobSha256={item.coverBlobSha256}
                        alt={`${item.title}的封面`}
                        width={48}
                        height={48}
                        fallback={item.title.slice(0, 1)}
                        fallbackClassName="grid h-full w-full place-items-center font-serif text-lg font-bold text-muted"
                      />
                    </span>
                  ) : item.kind === "creator" ? (
                    <CreatorPortrait avatarBlobSha256={item.avatarBlobSha256} name={item.title} size={48} className="size-8 text-lg" />
                  ) : (
                    <CharacterPortrait portrait={item.portrait} displayName={item.title} toneKey={item.id} size={32} className="size-8 text-lg" />
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <a
                    href={item.href}
                    target={desktop ? "rakuen-content" : undefined}
                    aria-current={activePath === item.entryHref ? "true" : undefined}
                    className="text-sm leading-relaxed text-primary [overflow-wrap:anywhere] hover:underline"
                  >
                    {item.title}{" "}
                    <span className="whitespace-nowrap text-xs text-muted" title={item.kind === "topic" ? "累计回复数" : "累计评论数"}>
                      (+{item.count})
                    </span>
                  </a>
                  <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-muted">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {item.kind === "topic" ? <TopicTags tags={item.tags} /> : (
                        <>
                          {sources[item.kind]}
                        </>
                      )}
                    </span>
                      <Timestamp value={item.activeAt} className="shrink-0 mr-2" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="暂无活动。" variant="plain" className="p-4" />
        )}
        <div className="px-4">
          <PaginationLinks
            basePath="/rakuen"
            params={{ type: type === "all" ? undefined : type }}
            page={page}
            pageSize={pageSize}
            total={total}
          />
        </div>
      </section>
      {/* Do not load a frame on mobile; keep an existing desktop frame when resized. */}
      {desktop || frameCreated ? (
        <iframe
          ref={frameRef}
          name="rakuen-content"
          title="超展开页面内容"
          src="about:blank"
          className="hidden h-full min-h-0 w-full border-0 border-l border-l-border bg-background lg:block"
          onLoad={(event) => {
            try {
              setActivePath(event.currentTarget.contentWindow?.location.pathname ?? "");
            } catch {
              setActivePath("");
            }
          }}
        />
      ) : null}
    </main>
  );
}
