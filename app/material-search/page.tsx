import { useEffect, useRef, useState, type DragEvent } from "react";
import { flushSync } from "react-dom";
import type { MetaFunction } from "react-router";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { WorkCard } from "@/app/components/work/work-card";
import type { MaterialSearchResponse, MaterialSearchResult } from "@/lib/dto/db/material-search";
import { MAX_IMAGE_BYTES } from "@/lib/image-format";
import { sha256Hex } from "@/lib/sha256";
import { requestJson } from "@/lib/ui/api-response";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import "./page.css";

export const meta: MetaFunction = ({ error }) => pageMetaDescriptors({ title: "大镜" }, error);

type Source = { file: File; url: string; previewable: boolean; sha256: string | null };
type Rect = Pick<DOMRect, "left" | "top" | "width" | "height">;
type Status = "idle" | "searching" | "found" | "empty" | "error";
type View = MaterialSearchResult & {
  source: Source | null;
  status: Status;
  loadingMore: boolean;
  moreError: boolean;
};
const INITIAL_VIEW: View = { source: null, status: "idle", works: [], nextCursor: null, loadingMore: false, moreError: false };
const EASING = "cubic-bezier(.2,.7,.2,1)";
const ACCEPT = ".png,.bmp,.xyz,.jpg,.jpeg,.gif,.ico,.webp";

export default function MaterialSearchPage() {
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const page = useRef<HTMLElement>(null);
  const sourceButton = useRef<HTMLButtonElement>(null);
  const prompt = useRef<HTMLButtonElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const activeSource = useRef<Source | null>(null);
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);
  const motions = useRef(new Set<Animation>());
  const urls = useRef(new Set<string>());
  const toast = useToast();

  useEffect(() => {
    const animations = motions.current;
    const objectUrls = urls.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function stopMotion() {
      if (reducedMotion.matches) {
        for (const animation of animations) animation.cancel();
        animations.clear();
      }
    }
    reducedMotion.addEventListener("change", stopMotion);
    return () => {
      revision.current += 1;
      request.current?.abort();
      for (const animation of animations) animation.cancel();
      for (const url of objectUrls) URL.revokeObjectURL(url);
      animations.clear();
      objectUrls.clear();
      reducedMotion.removeEventListener("change", stopMotion);
    };
  }, []);

  function animate(element: HTMLElement | null, frames: Keyframe[], duration: number, fill: FillMode = "none") {
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    const animation = element.animate(frames, { duration, easing: EASING, fill });
    motions.current.add(animation);
    return animation.finished.catch(() => {}).then(() => {
      // Keep completed exit animations cancelable until the next state commits.
      if (fill !== "forwards") motions.current.delete(animation);
    });
  }

  function commit(next: View, origin?: Rect | null, duration = 380) {
    const before = origin === undefined ? sourceButton.current?.getBoundingClientRect() : origin;
    const oldHeight = page.current?.getBoundingClientRect().height;
    for (const animation of motions.current) animation.cancel();
    motions.current.clear();
    flushSync(() => setView(next));
    const newHeight = page.current?.getBoundingClientRect().height;
    if (oldHeight && newHeight && Math.abs(oldHeight - newHeight) > 1) {
      // Animate the page's flow height so the existing footer follows the cards.
      void animate(page.current, [{ height: `${oldHeight}px` }, { height: `${newHeight}px` }], 360);
    }
    const after = sourceButton.current?.getBoundingClientRect();
    if (!after) return Promise.resolve();
    if (!before) return animate(sourceButton.current, [{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], 240);
    return animate(sourceButton.current, [
      { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width}, ${before.height / after.height})` },
      { transform: "none" },
    ], duration);
  }

  function beginRequest() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    return { controller, version: ++revision.current };
  }

  async function query(source: Source, controller: AbortController, before?: number) {
    // Hash the original bytes locally; neither the file nor its name is uploaded.
    source.sha256 ??= await sha256Hex(await source.file.arrayBuffer());
    if (controller.signal.aborted) throw new DOMException("搜索已取消", "AbortError");
    const params = new URLSearchParams({ sha256: source.sha256 });
    if (before !== undefined) params.set("before", String(before));
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      return await requestJson<MaterialSearchResponse>(`/api/material-search?${params}`, { signal: controller.signal }, "素材搜索失败");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function search(source: Source, controller: AbortController, version: number, arrival: Promise<void>) {
    try {
      // Start the real query immediately; coordinate its presentation with the
      // image's arrival rather than adding a simulated loading timer.
      const [response] = await Promise.all([query(source, controller), arrival]);
      if (version !== revision.current) return;
      void commit({ ...INITIAL_VIEW, source, ...response, status: response.works.length ? "found" : "empty" });
    } catch {
      await arrival;
      if (version !== revision.current) return;
      void commit({ ...INITIAL_VIEW, source, status: "error" });
    } finally {
      if (version === revision.current) request.current = null;
    }
  }

  async function selectFiles(files: File[], origin?: Rect) {
    if (!files.length) return;
    if (files.length !== 1) { toast.error("一次请选择一张素材图"); return; }
    const file = files[0];
    if (!/\.(png|bmp|xyz|jpe?g|gif|ico|webp)$/i.test(file.name)) { toast.error("请选择支持的图片文件"); return; }
    if (!file.size || file.size > MAX_IMAGE_BYTES) { toast.error("素材图必须非空且不能超过 20 MiB"); return; }
    const { controller, version } = beginRequest();
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    const preview = new Image();
    preview.src = url;
    const outgoing = results.current ?? prompt.current;
    const [previewable] = await Promise.all([
      preview.decode().then(() => true, () => false),
      outgoing ? animate(outgoing, [{ opacity: getComputedStyle(outgoing).opacity, transform: "none" }, { opacity: 0, transform: "translateY(4px)" }], 120, "forwards") : Promise.resolve(),
    ]);
    if (version !== revision.current) { releaseUrl(url); return; }
    const previous = activeSource.current;
    const source: Source = { file, url, previewable, sha256: null };
    activeSource.current = source;
    const arrival = commit({ ...INITIAL_VIEW, source, status: "searching" }, origin, 420);
    sourceButton.current?.focus({ preventScroll: true });
    if (previous) releaseUrl(previous.url);
    void search(source, controller, version, arrival);
  }

  function releaseUrl(url: string) {
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  }

  function retry() {
    const source = activeSource.current;
    if (!source) return;
    const { controller, version } = beginRequest();
    const arrival = commit({ ...INITIAL_VIEW, source, status: "searching" });
    sourceButton.current?.focus({ preventScroll: true });
    void search(source, controller, version, arrival);
  }

  async function loadMore() {
    if (!view.source || view.nextCursor === null || view.loadingMore) return;
    const { controller, version } = beginRequest();
    setView({ ...view, loadingMore: true, moreError: false });
    try {
      const response = await query(view.source, controller, view.nextCursor);
      if (version !== revision.current) return;
      // Current versions can change between pages. Keep cards already displayed
      // and avoid duplicating a work if it gained a different current version.
      const existing = new Set(view.works.map((work) => work.id));
      void commit({ ...view, works: [...view.works, ...response.works.filter((work) => !existing.has(work.id))], nextCursor: response.nextCursor, loadingMore: false, moreError: false });
    } catch {
      if (version === revision.current) setView({ ...view, loadingMore: false, moreError: true });
    } finally {
      if (version === revision.current) request.current = null;
    }
  }

  function isFileDrag(event: DragEvent) {
    return event.dataTransfer.types.includes("Files");
  }

  function drop(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const bounds = event.currentTarget.getBoundingClientRect();
    const size = 72;
    const origin = {
      left: Math.max(bounds.left, Math.min(event.clientX - size / 2, bounds.right - size)),
      top: Math.max(bounds.top, Math.min(event.clientY - size / 2, bounds.bottom - size)),
      width: size, height: size,
    };
    void selectFiles(Array.from(event.dataTransfer.files), origin);
  }

  return (
    <main ref={page} className="material-search-page" data-status={view.status} data-dragging={dragging} aria-labelledby="material-search-title"
      onDragEnter={(event) => { if (isFileDrag(event)) { event.preventDefault(); dragDepth.current += 1; setDragging(true); } }}
      onDragLeave={(event) => { if (isFileDrag(event)) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); } }}
      onDragOver={(event) => { if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={drop}>
      <h1 id="material-search-title" className="sr-only">大镜</h1>
      <input ref={input} type="file" accept={ACCEPT} aria-label="选择 tkool 素材图" className="sr-only" tabIndex={-1}
        onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void selectFiles(files); }} />
      <div className="material-search-body">
        <div className="material-search-stage">
          {view.source ? <Button ref={sourceButton} type="button" variant="ghost" className="material-search-source"
            aria-label="选择另一张素材图" title="选择另一张素材图" onClick={() => input.current?.click()}>
            {view.source.previewable ? <img src={view.source.url} alt={view.source.file.name} draggable={false} className="material-search-image" />
              : <span className="material-search-fallback">无法预览</span>}
          </Button> : null}
          {view.status === "idle" ? <Button ref={prompt} type="button" variant="ghost" className="material-search-prompt" onClick={() => input.current?.click()}>
            把tkool素材拖到这里
          </Button> : null}
          {view.status === "searching" ? <p key="searching" role="status" className="material-search-sentence material-search-loading">正在搜索…</p> : null}
        </div>
        {!["idle", "searching"].includes(view.status) ? <div ref={results} key={view.status} className="material-search-results">
          <p role="status" className="material-search-sentence">
            {view.status === "found" ? "这张素材在这些作品里出现过" : null}
            {view.status === "empty" ? "没有找到包含这张素材的作品" : null}
            {view.status === "error" ? <Button type="button" variant="ghost" className="material-search-retry" onClick={retry}>搜索失败，请点击重试</Button> : null}
          </p>
          {view.status === "found" ? <>
            <div className="material-search-cards" aria-label="包含这张素材的作品">
              {view.works.map((work) => <div key={work.id} className="material-search-card">
                <WorkCard href={`/games/${work.id}`} title={work.chineseTitle || work.originalTitle} originalTitle={work.originalTitle}
                  coverBlobSha256={work.coverBlobSha256} titleAs="h2" />
              </div>)}
            </div>
            {view.nextCursor !== null ? <Button type="button" variant="ghost" className="material-search-more" disabled={view.loadingMore}
              onClick={() => void loadMore()}>{view.loadingMore ? "正在加载…" : view.moreError ? "加载失败，请点击重试" : "加载更多"}</Button> : null}
            <span className="sr-only" role="status">{view.loadingMore ? "正在加载更多作品" : view.moreError ? "加载失败" : `已显示 ${view.works.length} 个作品`}</span>
          </> : null}
        </div> : null}
      </div>
    </main>
  );
}
