import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, File, FileArchive, Folder, FolderOpen, Search, FilePlus2, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import * as Dialog from "@/app/components/ui/dialog";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { Input } from "@/app/components/ui/input";
import { TreeIndent } from "@/app/components/ui/tree-layout";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { resourceMediaDirectories } from "@/lib/archive/resource-cleanup";
import { formatBytes } from "@/lib/format";
import { normalizeFolderSource } from "./archive-source-picker";
import type { BrowserUploadTaskSnapshot, UploadExtraCandidate, UploadSourceFile, UploadSourceKind } from "./upload-types";

type FileNode = { region?: boolean; path: string; name: string; size: number; paths: string[]; children: Map<string, FileNode> | null };

export function ArchiveExtrasPicker({ task, candidates, sourceAvailable, onConfirm, onReloadSource }: {
  task: BrowserUploadTaskSnapshot;
  candidates: UploadExtraCandidate[];
  sourceAvailable: boolean;
  onConfirm: (paths: string[]) => void;
  onReloadSource: (files: UploadSourceFile[], kind: UploadSourceKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string> | null>(new Set());
  const [query, setQuery] = useState("");
  const sourceInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const extras = task.extras ?? [];
  const tree = useMemo(() => {
    const children = new Map<string, FileNode>();
    const directories: string[] = [];
    const unused: FileNode = { region: true, path: "\0unused-resources", name: "游戏中未引用的素材", size: 0, paths: [], children: new Map() };
    const saves: FileNode = { region: true, path: "\0save-files", name: "存档文件", size: 0, paths: [], children: new Map() };
    const matching = candidates.filter(file => file.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    for (const file of matching) {
      const parts = file.path.split("/");
      let branch = children;
      const region = /\.lsd$/i.test(file.path) ? saves
        : parts.length > 1 && resourceMediaDirectories.has(parts[0].toLowerCase()) ? unused : null;
      if (region) {
        region.paths.push(file.path);
        region.size += file.size;
        branch = region.children!;
      }
      for (let i = 0; i < parts.length; i++) {
        const path = (region ? `${region.path}/` : "") + parts.slice(0, i + 1).join("/");
        let node = branch.get(parts[i]);
        if (!node) {
          const folder = i < parts.length - 1;
          node = { path, name: parts[i], size: 0, paths: [], children: folder ? new Map() : null };
          branch.set(parts[i], node);
          if (folder) directories.push(path);
        }
        node.size += file.size;
        node.paths.push(file.path);
        if (node.children) branch = node.children;
      }
    }
    for (const region of [saves, unused]) {
      if (!region.paths.length) continue;
      children.set(region.path, region);
      directories.push(region.path);
    }
    return { children, directories, matching };
  }, [candidates, query]);
  const selectedFiles = candidates.filter(file => selected.has(file.path));
  function toggle(paths: string[], checked: boolean) {
    setSelected(current => {
      const next = new Set(current);
      for (const path of paths) { if (checked) next.add(path); else next.delete(path); }
      return next;
    });
  }
  function toggleExpanded(path: string) {
    setExpanded(current => {
      const next = new Set(current ?? tree.directories);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  return (
    <>
      <Dialog.Root open={open} onOpenChange={value => {
        if (task.extrasBusy) return;
        if (value) {
          setSelected(new Set(extras.map(file => file.path)));
          setExpanded(new Set());
          setQuery("");
        }
        setOpen(value);
      }}>
        <Dialog.Trigger asChild>
          <Button type="button" size="sm" variant="outline" disabled={task.extrasBusy}><FilePlus2 aria-hidden />追加文件</Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }} className="left-1/2 top-1/2 flex h-[min(80dvh,42rem)] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg">
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
              <Dialog.Title ref={titleRef} tabIndex={-1} className="outline-none">追加文件</Dialog.Title>
              <InfoTooltip>
                网站的上传器会自动清理游戏中未引用的素材、存档与无关文件。<br />
                如果认为这些被排除的类目中存在需要被归档的内容，请在这个页面勾选以补充上传。
              </InfoTooltip>
              <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" className="ml-auto" aria-label="关闭追加文件" disabled={task.extrasBusy}><X aria-hidden /></Button></Dialog.Close>
            </header>
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/5 px-4 py-2 text-sm">
              {task.sourceKind === "folder" ? <FolderOpen aria-hidden className="size-4 shrink-0 text-primary" /> : <FileArchive aria-hidden className="size-4 shrink-0 text-primary" />}
              <span className="min-w-0 flex-1 break-all leading-relaxed" title={task.sourceName}>{task.sourceName}</span>
              <span className="shrink-0 text-xs text-muted">{tree.matching.length.toLocaleString("zh-CN")} 个文件</span>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-3">
              <div className="relative min-w-32 flex-1">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input type="search" aria-label="搜索追加文件" placeholder="搜索文件或路径" className="h-9 pl-9" value={query}
                  onChange={event => { setQuery(event.target.value); setExpanded(event.target.value.trim() ? null : new Set()); }} />
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(new Set(tree.directories))}>全部展开</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(new Set())}>全部折叠</Button>
              {!sourceAvailable ? <>
                <Button type="button" size="sm" variant="outline" disabled={task.extrasBusy} onClick={() => sourceInput.current?.click()}>重新选择来源</Button>
                <input ref={sourceInput} type="file" className="hidden" aria-label="原始游戏文件"
                  {...(task.sourceKind === "folder" ? { webkitdirectory: "", multiple: true } : { accept: ".zip,.7z" })}
                  onChange={event => {
                    const files = Array.from(event.target.files ?? []);
                    if (!files.length) return;
                    if (task.sourceKind === "folder") onReloadSource(normalizeFolderSource(files.map(file => ({ file, relativePath: file.webkitRelativePath || file.name })), task.sourceName).files, "folder");
                    else onReloadSource([{ file: files[0], relativePath: files[0].name }], task.sourceKind);
                    event.target.value = "";
                  }} />
              </> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <div className="sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b border-border bg-card px-4 text-xs text-muted">
                <Checkbox id={`${id}-all`} aria-label="选择全部显示的文件" disabled={task.extrasBusy || !tree.matching.length}
                  checked={tree.matching.length > 0 && tree.matching.every(file => selected.has(file.path)) ? true : tree.matching.some(file => selected.has(file.path)) ? "indeterminate" : false}
                  onCheckedChange={checked => toggle(tree.matching.map(file => file.path), checked === true)} />
                <span className="flex-1 pl-6">名称</span><span className="w-20 text-right">大小</span>
              </div>
              {!tree.matching.length ? <p className="p-6 text-center text-sm text-muted">{query.trim() ? "没有匹配的文件。" : sourceAvailable ? "没有可追加的文件。" : "重新选择来源后可添加更多文件。"}</p> : null}
              <FileTree nodes={tree.children} depth={0} id={id} selected={selected} expanded={expanded}
                disabled={Boolean(task.extrasBusy)} onToggle={toggle} onExpand={toggleExpanded} />
            </div>
            {task.extrasError ? <Notice tone="error" role="alert" className="mx-4 mb-3 p-2 text-sm">{task.extrasError}</Notice> : null}
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/5 px-4 py-3">
              <span className="mr-auto text-sm" aria-live="polite">已选择 {selectedFiles.length.toLocaleString("zh-CN")} 个文件 · {formatBytes(selectedFiles.reduce((sum, file) => sum + file.size, 0))}</span>
              <Dialog.Close asChild><Button type="button" variant="outline" disabled={task.extrasBusy}>取消</Button></Dialog.Close>
              <Button type="button" disabled={task.extrasBusy} onClick={() => { onConfirm([...selected]); setOpen(false); }}>确定</Button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {extras.length ? <span className="order-first mr-auto text-xs text-muted">追加文件：{extras.length} 个文件 · {formatBytes(extras.reduce((sum, file) => sum + file.size, 0))}</span> : null}
      {task.extrasBusy ? <span className="w-full text-sm" role="status">正在处理追加文件{task.extrasProgress ? ` ${task.extrasProgress.completed}/${task.extrasProgress.total}` : ""}{task.progress.currentPath ? `：${task.progress.currentPath}` : "…"}</span> : null}
      {task.extrasError ? <Notice tone="error" role="alert" className="w-full p-2 text-sm">{task.extrasError}</Notice> : null}
    </>
  );
}

function FileTree({ nodes, depth, id, selected, expanded, disabled, onToggle, onExpand }: {
  nodes: Map<string, FileNode>; depth: number; id: string; selected: Set<string>; expanded: Set<string> | null; disabled: boolean;
  onToggle: (paths: string[], checked: boolean) => void; onExpand: (path: string) => void;
}) {
  return <ul className="m-0 list-none p-0">
    {[...nodes.values()].sort((a, b) => Number(Boolean(a.region)) - Number(Boolean(b.region)) || Number(Boolean(b.children)) - Number(Boolean(a.children)) || a.name.localeCompare(b.name, "zh-CN", { numeric: true })).map(node => {
      const open = expanded === null || expanded.has(node.path);
      const checked = node.paths.every(path => selected.has(path));
      const partial = !checked && node.paths.some(path => selected.has(path));
      const checkboxId = `${id}-${encodeURIComponent(node.path)}`;
      const displayPath = node.region ? node.name : node.path.replace(/^\0(?:unused-resources|save-files)\//, "");
      return <li key={node.path}>
        <TreeIndent depth={depth} step="1.25rem">
        <div className={`flex min-h-10 items-center gap-2 border-b border-border/40 px-4 text-sm hover:bg-muted/10 ${checked ? "bg-primary/5" : ""}`}>
          <Checkbox id={checkboxId} aria-label={node.children ? `选择${node.region ? "区域" : "文件夹"} ${displayPath}` : displayPath} checked={checked ? true : partial ? "indeterminate" : false}
            disabled={disabled} onCheckedChange={value => onToggle(node.paths, value === true)} />
          {node.children ? <Button type="button" variant="ghost" aria-expanded={open} aria-label={`${open ? "折叠" : "展开"} ${displayPath}`}
            className="h-auto min-h-10 min-w-0 flex-1 justify-start gap-2 whitespace-normal rounded-sm px-0 py-2 text-left font-normal leading-relaxed hover:bg-transparent"
            onClick={() => onExpand(node.path)}>
            {open ? <ChevronDown aria-hidden className="size-3.5 shrink-0" /> : <ChevronRight aria-hidden className="size-3.5 shrink-0" />}
            {!node.region ? (open ? <FolderOpen aria-hidden className="size-4 shrink-0 text-primary" /> : <Folder aria-hidden className="size-4 shrink-0 text-primary" />) : null}
            <span className="min-w-0 break-all leading-relaxed" title={displayPath}>{node.name}</span>
            <span className="shrink-0 text-xs text-muted">{node.paths.length.toLocaleString("zh-CN")}</span>
          </Button> : <Label htmlFor={checkboxId} title={displayPath} className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pl-[1.375rem] font-normal leading-relaxed">
            <File aria-hidden className="size-4 shrink-0 text-muted" /><span className="min-w-0 break-all leading-relaxed">{node.name}</span>
          </Label>}
          <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted">{formatBytes(node.size)}</span>
        </div>
        </TreeIndent>
        {node.children && open ? <FileTree nodes={node.children} depth={depth + 1} id={id} selected={selected} expanded={expanded}
          disabled={disabled} onToggle={onToggle} onExpand={onExpand} /> : null}
      </li>;
    })}
  </ul>;
}
