import { ColumnGrid } from "@/app/components/ui/column-grid";
import { TreeGuides, TreeIndent } from "@/app/components/ui/tree-layout";

import { CharacterCard } from "@/app/components/characters/character-card";
import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import type {
  VirtualListHandle,
  VirtualListStickyItem,
} from "@/app/components/ui/virtual-list";
import { VirtualList } from "@/app/components/ui/virtual-list";
import type {
  CharacterBrowseNode,
  CharacterIndexData,
} from "@/lib/character-index";
import { buildCharacterBrowseTree } from "@/lib/character-index";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { ChevronRight, FolderPen, ListTree, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CharacterNode = Extract<CharacterBrowseNode, { kind: "character" }>;
type BrowseRow = {
  key: string;
  node: CharacterBrowseNode;
  depth: number;
  characters: CharacterNode[];
  groupEnd?: boolean;
  continuation?: string;
};

const RETURN_TARGET_STATE = "viprpgCharacterIndexReturnTarget";

function characterCount(node: CharacterBrowseNode): number {
  if (node.kind === "character") return 1;
  return node.children.reduce(
    (count, child) => count + characterCount(child),
    0,
  );
}

function matchingBranches(nodes: CharacterBrowseNode[]): Set<string> {
  const expanded = new Set<string>();
  const collect = (node: CharacterBrowseNode): boolean => {
    if (node.kind === "character") return true;
    const hasMatch = node.children.map(collect).some(Boolean);
    if (hasMatch) expanded.add(node.id);
    return hasMatch;
  };
  nodes.forEach(collect);
  return expanded;
}

export function CharacterIndexBrowser({
  canEdit,
  canEditIndex,
  data,
  initialQuery,
}: {
  canEdit: boolean;
  canEditIndex: boolean;
  data: CharacterIndexData;
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState(() =>
    initialQuery
      ? matchingBranches(buildCharacterBrowseTree(data, initialQuery).roots)
      : new Set<string>(),
  );
  const { roots, matchCount } = useMemo(
    () => buildCharacterBrowseTree(data, ""),
    [data],
  );
  const matchingRoots = useMemo(
    () => (query ? buildCharacterBrowseTree(data, query).roots : roots),
    [data, query, roots],
  );
  const listRef = useRef<VirtualListHandle>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [measuredColumns, setColumns] = useState<number | null>(null);
  const columns = measuredColumns ?? 1;
  const returnRestoredRef = useRef(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuScrollTop = useRef(0);
  const restoreMenuScroll = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollTop = menuScrollTop.current;
  }, []);
  const pendingNavigationRef = useRef<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const applyFilter = (value: string) => {
    const nextQuery = value.trim();
    setDraftQuery(nextQuery);
    setQuery(nextQuery);
    if (nextQuery)
      setExpanded(
        matchingBranches(buildCharacterBrowseTree(data, nextQuery).roots),
      );
  };
  const changeDraft = (value: string) => {
    setDraftQuery(value);
    if (!value.trim()) setQuery("");
  };
  const toggleBranch = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const filteredMenu = useMemo(() => {
    const matchedIds = new Set<string>();
    const collect = (nodes: CharacterBrowseNode[]) => {
      for (const node of nodes) {
        if (node.kind === "character") matchedIds.add(node.id);
        else collect(node.children);
      }
    };
    collect(matchingRoots);
    const filter = (nodes: CharacterBrowseNode[]): CharacterBrowseNode[] =>
      nodes.flatMap((node): CharacterBrowseNode[] => {
        if (node.kind === "category")
          return [{ ...node, children: filter(node.children) }];
        return matchedIds.has(node.id) ? [node] : [];
      });
    return filter(roots);
  }, [roots, matchingRoots]);
  const rows = useMemo<BrowseRow[]>(() => {
    const flatten = (
      nodes: CharacterBrowseNode[],
      depth: number,
      parentLabel?: string,
    ): BrowseRow[] => {
      const result: BrowseRow[] = [];
      let pending: CharacterNode[] = [];
      let afterCategory = false;
      let continuation: string | undefined;
      const flush = () => {
        if (!pending.length) return;
        result.push({
          key: pending.map((node) => node.id).join("|"),
          node: pending[0],
          depth,
          characters: pending,
          continuation,
        });
        pending = [];
        continuation = undefined;
      };
      for (const node of nodes) {
        if (node.kind === "category") {
          flush();
          result.push(
            { key: node.id, node, depth, characters: [] },
            ...flatten(node.children, depth + 1, node.label),
          );
          if (depth >= 2)
            result.push({
              key: `${node.id}:end`,
              node,
              depth: depth + 1,
              characters: [],
              groupEnd: true,
            });
          afterCategory = true;
        } else {
          if (afterCategory && parentLabel)
            continuation = `其他 ${parentLabel}角色`;
          afterCategory = false;
          pending.push(node);
          if (pending.length === columns) flush();
        }
      }
      flush();
      return result;
    };
    return flatten(roots, 1);
  }, [roots, columns]);
  const itemKeys = useMemo(() => rows.map((row) => row.key), [rows]);
  const anchorKeys = useMemo(
    () =>
      rows.map((row) =>
        row.characters.length
          ? row.characters.map((node) => node.id)
          : [row.key],
      ),
    [rows],
  );
  const stickyItems = useMemo(() => {
    const items: VirtualListStickyItem[] = [];
    const stack: VirtualListStickyItem[] = [];
    rows.forEach((row, index) => {
      // Keep each heading through its own closing row, then release it before its parent's closing row.
      if (row.groupEnd) {
        while (stack.length && rows[stack.at(-1)!.index].depth >= row.depth - 1)
          stack.pop()!.endIndex = index + 1;
        return;
      }
      while (stack.length && rows[stack.at(-1)!.index].depth >= row.depth)
        stack.pop()!.endIndex = index;
      if (row.node.kind !== "category") return;
      const item = {
        index,
        endIndex: rows.length,
        ancestors: stack.map((parent) => parent.index),
      };
      items.push(item);
      stack.push(item);
    });
    return items;
  }, [rows]);
  const estimateHeight = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row.groupEnd) return 24;
      return row.node.kind === "category"
        ? row.depth === 1
          ? 52
          : row.depth === 2
            ? 44
            : 36
        : 144 + (row.continuation ? 36 : 0);
    },
    [rows],
  );
  const measurementGroup = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row.groupEnd) return "group-end";
      return row.node.kind === "category"
        ? `category:${Math.min(row.depth, 3)}`
        : `characters:plain:${Boolean(row.continuation)}`;
    },
    [rows],
  );
  const rowKeys = useMemo(
    () =>
      new Map(
        rows
          .filter((row) => !row.groupEnd)
          .flatMap((row) => [
            [row.node.id, row.key] as const,
            ...row.characters.map((node) => [node.id, row.key] as const),
          ]),
      ),
    [rows],
  );
  const navigate = (key: string) => {
    setSelected(key);
    listRef.current?.scrollToKey(key);
  };
  const navigateFromDrawer = (key: string) => {
    pendingNavigationRef.current = key;
    setSelected(key);
    setMenuOpen(false);
  };
  const rememberReturnTarget = (key: string) => {
    // Keep the membership key on this history entry: one character can appear in several categories.
    window.history.replaceState(
      { ...window.history.state, [RETURN_TARGET_STATE]: key },
      "",
    );
  };
  useEffect(() => {
    const element = cardsRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      setColumns(width >= 840 ? 3 : width >= 520 ? 2 : 1);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      returnRestoredRef.current = false;
    };
  }, []);
  useEffect(() => {
    // Responsive columns change row keys. Restore only after the actual layout is known.
    if (measuredColumns === null || returnRestoredRef.current) return;
    const key: unknown = window.history.state?.[RETURN_TARGET_STATE];
    if (typeof key !== "string" || !rowKeys.has(key)) return;
    const frame = requestAnimationFrame(() => {
      if (!listRef.current) return;
      returnRestoredRef.current = true;
      setSelected(key);
      listRef.current.scrollToKey(key);
    });
    return () => cancelAnimationFrame(frame);
  }, [measuredColumns, rowKeys]);
  useEffect(() => {
    const header = document.getElementById("site-header");
    if (!header) return;
    // The navigation can change height with font size, zoom, and responsive layout.
    const observer = new ResizeObserver(() =>
      setHeaderHeight(header.getBoundingClientRect().height),
    );
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 48rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className="grid items-start gap-5 md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
      <nav
        aria-label="角色分类目录"
        className="hidden max-h-[calc(100dvh-6rem)] flex-col overflow-hidden border-border pb-3 md:sticky md:top-20 md:flex md:border-r md:pr-3"
      >
        <CharacterFilter
          draftQuery={draftQuery}
          onDraftChange={changeDraft}
          onApply={applyFilter}
        />
        <div className={`${characterMenuScrollbarClassName} min-h-0 overflow-y-auto overscroll-contain`}>
          <CharacterMenu
            nodes={filteredMenu}
            onNavigate={navigate}
            selected={selected}
            expanded={expanded}
            onToggle={toggleBranch}
          />
        </div>
      </nav>
      <Dialog.Root onOpenChange={setMenuOpen} open={menuOpen}>
        <Dialog.Trigger asChild>
          <Button
            aria-label="打开角色分类目录"
            className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-[calc(1rem+env(safe-area-inset-left))] z-40 min-h-12 gap-2 rounded-full px-4 shadow-surface md:hidden"
            ref={menuTriggerRef}
            type="button"
          >
            <ListTree aria-hidden />
            分类
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="bg-black/40 md:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="inset-y-0 left-0 flex h-dvh w-[min(85vw,20rem)] flex-col border-r bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] md:hidden"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuTriggerRef.current?.focus({ preventScroll: true });
              const key = pendingNavigationRef.current;
              pendingNavigationRef.current = null;
              if (key) listRef.current?.scrollToKey(key);
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
              <Dialog.Title className="text-base font-semibold">
                阵营与角色群
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button
                  aria-label="关闭角色分类目录"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <nav
              aria-label="移动端角色分类目录"
              className="flex min-h-0 flex-1 flex-col overflow-hidden p-3"
            >
              <CharacterFilter
                draftQuery={draftQuery}
                onDraftChange={changeDraft}
                onApply={applyFilter}
              />
              <div
                ref={restoreMenuScroll}
                onScroll={(event) => {
                  menuScrollTop.current = event.currentTarget.scrollTop;
                }}
                className={`${characterMenuScrollbarClassName} min-h-0 flex-1 overflow-y-auto overscroll-contain`}
              >
                <CharacterMenu
                  nodes={filteredMenu}
                  onNavigate={navigateFromDrawer}
                  selected={selected}
                  expanded={expanded}
                  onToggle={toggleBranch}
                />
              </div>
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div className="min-w-0" ref={cardsRef}>
        {matchCount > 0 ? (
          <VirtualList
            className="min-w-0 [--character-indent:0.5rem] md:[--character-indent:1rem]"
            estimateHeight={estimateHeight}
            measurementGroup={measurementGroup}
            itemKeys={itemKeys}
            anchorKeys={anchorKeys}
            label="角色列表"
            ref={listRef}
            scrollOffset={headerHeight}
            stickyItems={stickyItems}
            renderItem={(index) => {
              const row = rows[index];
              const node = row.node;
              const guideCount = Math.max(
                0,
                row.depth - (node.kind === "category" && !row.groupEnd ? 1 : 2),
              );
              if (row.groupEnd)
                return (
                  <div aria-hidden className="relative h-6">
                    <TreeGuides
                      depth={guideCount}
                      step="var(--character-indent)"
                      closing
                    />
                  </div>
                );
              if (node.kind === "category")
                return (
                  <TreeIndent
                    as="header"
                    depth={guideCount}
                    step="var(--character-indent)"
                    className={cn(
                      "relative flex items-center bg-background py-2 pr-3",
                      row.depth === 1
                        ? "min-h-13 border-b border-border"
                        : row.depth === 2
                          ? "min-h-11"
                          : "min-h-9",
                    )}
                  >
                    <TreeGuides
                      depth={guideCount}
                      step="var(--character-indent)"
                    />
                    <div className="flex min-w-0 items-center gap-2">
                      <h2
                        aria-level={Math.min(row.depth + 1, 6)}
                        className={cn(
                          "min-w-0 break-words",
                          row.depth === 1
                            ? "font-display text-2xl font-semibold"
                            : row.depth === 2
                              ? "text-base font-semibold"
                              : "text-sm font-semibold",
                        )}
                      >
                        {node.label}
                      </h2>
                      <span className="text-xs tabular-nums text-muted">
                        {formatNumber(characterCount(node))}
                      </span>
                      {canEditIndex ? (
                        <a
                          aria-label={`编辑分类 ${node.label}`}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          href={`/admin/characters/index?category=${encodeURIComponent(node.id)}`}
                          title="编辑分类"
                        >
                          <FolderPen aria-hidden size={13} />
                        </a>
                      ) : null}
                    </div>
                  </TreeIndent>
                );
              return (
                <TreeIndent
                  className="relative py-1.5"
                  depth={guideCount}
                  step="var(--character-indent)"
                >
                  <TreeGuides
                    depth={guideCount}
                    step="var(--character-indent)"
                  />
                  {row.continuation ? (
                    <h2
                      aria-level={Math.min(row.depth + 1, 6)}
                      className="pb-3 text-sm font-medium text-muted"
                    >
                      {row.continuation}
                    </h2>
                  ) : null}
                  <ColumnGrid columns={columns} className="items-stretch gap-3">
                    {row.characters.map((entry) => (
                      <CharacterCard
                        canEdit={canEdit}
                        canEditIndex={canEditIndex}
                        categoryId={entry.categoryId}
                        character={entry.character}
                        displayName={entry.label}
                        key={entry.id}
                        onOpen={() => rememberReturnTarget(entry.id)}
                        originalName={entry.originalName}
                        selected={selected === entry.id}
                      />
                    ))}
                  </ColumnGrid>
                </TreeIndent>
              );
            }}
          />
        ) : (
          <EmptyState title="暂无角色。" />
        )}
      </div>
    </div>
  );
}

function CharacterFilter({
  draftQuery,
  onDraftChange,
  onApply,
}: {
  draftQuery: string;
  onDraftChange: (value: string) => void;
  onApply: (value: string) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draftQuery);
      }}
      role="search"
      aria-label="筛选角色"
      className="mb-4 shrink-0 space-y-2 border-b border-border pb-3"
    >
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="筛选角色"
          className="h-8 px-2 py-1 text-xs"
          value={draftQuery}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="名称、别名或阵营"
          type="search"
        />
        <Button
          aria-label="搜索"
          className="size-8"
          size="icon"
          title="搜索"
          type="submit"
        >
          <Search aria-hidden />
        </Button>
      </div>
    </form>
  );
}

function CharacterMenu({
  nodes,
  selected,
  onNavigate,
  expanded,
  onToggle,
}: {
  nodes: CharacterBrowseNode[];
  selected: string | null;
  onNavigate: (key: string) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "category" ? (
          <MenuBranch
            count={characterCount(node)}
            open={expanded.has(node.id)}
            onToggle={() => onToggle(node.id)}
            key={node.id}
            label={node.label}
          >
            <CharacterMenu
              nodes={node.children}
              onNavigate={onNavigate}
              selected={selected}
              expanded={expanded}
              onToggle={onToggle}
            />
          </MenuBranch>
        ) : (
          <Button
            aria-current={selected === node.id ? "location" : undefined}
            className={cn(
              "min-h-7 w-full justify-start whitespace-normal rounded-sm px-2 py-1 text-left text-xs font-normal leading-snug",
              selected === node.id && "bg-primary/10 text-primary",
            )}
            key={node.id}
            onClick={() => onNavigate(node.id)}
            type="button"
            variant="ghost"
          >
            {node.label}
          </Button>
        ),
      )}
    </>
  );
}

function MenuBranch({
  label,
  count,
  children,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <div className="flex items-start">
        <Button
          aria-expanded={open}
          aria-label={`${open ? "收起" : "展开"}${label}`}
          className="size-7 min-h-7 shrink-0 rounded-sm p-0"
          onClick={onToggle}
          type="button"
          variant="ghost"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3 transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
        </Button>
        <Button
          aria-expanded={open}
          className="min-h-7 min-w-0 flex-1 justify-between gap-2 whitespace-normal rounded-sm px-1 py-1 text-left text-xs leading-snug"
          onClick={onToggle}
          type="button"
          variant="ghost"
        >
          <span>{label}</span>
          <span className="text-[11px] font-normal tabular-nums text-muted">
            {formatNumber(count)}
          </span>
        </Button>
      </div>
      {open ? (
        <div className="ml-3 border-l border-border pl-2">{children}</div>
      ) : null}
    </div>
  );
}

const characterMenuScrollbarClassName = "[scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--color-muted)_22%,transparent)_transparent] hover:[scrollbar-color:color-mix(in_srgb,var(--color-muted)_50%,transparent)_transparent] focus-within:[scrollbar-color:color-mix(in_srgb,var(--color-muted)_50%,transparent)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--color-muted)_22%,transparent)] hover:[&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--color-muted)_50%,transparent)] focus-within:[&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--color-muted)_50%,transparent)]";
