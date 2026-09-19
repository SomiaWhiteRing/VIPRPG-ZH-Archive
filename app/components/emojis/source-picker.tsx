import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Flame,
  Folder,
  Search,
} from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { Input } from "@/app/components/ui/input";
import { TreeIndent } from "@/app/components/ui/tree-layout";
import type { EmojiCategory, EmojiCharacter } from "@/lib/face-emojis";
import { cn } from "@/lib/ui/cn";
import { emojiRequest } from "./client";

type CharacterPage = { items: EmojiCharacter[]; more: boolean };
type Branch = CharacterPage & { loading?: boolean; error?: string };

export function EmojiSourcePicker({
  character,
  label,
  hot,
  onSelect,
  onHot,
}: {
  character?: EmojiCharacter;
  label: string;
  hot: boolean;
  onSelect: (character: EmojiCharacter) => void;
  onHot: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<EmojiCategory[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const pending = useRef(new Set<string>());
  const tree = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState<CharacterPage & { query: string }>({
    query: "",
    items: [],
    more: false,
  });
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open || categories) return;
    const controller = new AbortController();
    void emojiRequest<{ items: EmojiCategory[] }>(
      "/api/emojis?op=categories",
      undefined,
      controller.signal,
    )
      .then((page) => {
        setCategories(page.items);
        setError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, [open, categories, retry]);
  useEffect(() => {
    if (!open || !query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      void emojiRequest<CharacterPage>(
        `/api/emojis?op=characters&q=${encodeURIComponent(query)}&offset=${offset}`,
        undefined,
        controller.signal,
      )
        .then((page) => {
          setResults((current) => ({
            ...page,
            query,
            items:
              offset && current.query === query
                ? [
                    ...new Map(
                      [...current.items, ...page.items].map((item) => [
                        item.id,
                        item,
                      ]),
                    ).values(),
                  ]
                : page.items,
          }));
          setError("");
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(String(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, offset, retry]);

  async function loadBranch(id: string, append = false) {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    setBranches((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? { items: [], more: false }),
        loading: true,
        error: undefined,
      },
    }));
    try {
      const page = await emojiRequest<CharacterPage>(
        `/api/emojis?op=characters&categoryId=${encodeURIComponent(id)}&offset=${append ? (branches[id]?.items.length ?? 0) : 0}`,
      );
      setBranches((current) => ({
        ...current,
        [id]: {
          ...page,
          items: append
            ? [...(current[id]?.items ?? []), ...page.items]
            : page.items,
        },
      }));
    } catch (error) {
      setBranches((current) => ({
        ...current,
        [id]: { ...current[id], loading: false, error: String(error) },
      }));
    } finally {
      pending.current.delete(id);
    }
  }
  function choose(item: EmojiCharacter) {
    onSelect(item);
    setOpen(false);
    setQuery("");
    setOffset(0);
  }
  const rowClass =
    "h-auto w-full min-w-0 justify-start gap-2 whitespace-normal rounded-sm px-2 py-2 text-left font-normal";
  function characterRow(item: EmojiCharacter, depth = 0, context = "") {
    return (
      <TreeIndent key={`${context}:${item.id}`} depth={depth} step="0.875rem">
        <Button
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={character?.id === item.id}
          variant="ghost"
          className={cn(
            rowClass,
            character?.id === item.id && "text-primary bg-primary/5",
          )}
          onClick={() => choose(item)}
        >
          <CharacterPortrait
            className="size-9 rounded-none text-sm"
            displayName={item.name}
            portrait={item.defaultPortrait}
            size={36}
            toneKey={item.id}
          />
          <span className="min-w-0 flex-1 break-words">
            {item.name}
            {item.originalName !== item.name ? (
              <span className="block text-xs text-muted">
                {item.originalName}
              </span>
            ) : null}
          </span>
          {character?.id === item.id ? <Check aria-hidden /> : null}
        </Button>
      </TreeIndent>
    );
  }
  function categoryRows(category: EmojiCategory, depth = 0): ReactNode {
    const isOpen = expanded.has(category.id),
      branch = branches[category.id];
    const children =
      categories?.filter((item) => item.parentId === category.id) ?? [];
    return (
      <div key={category.id}>
        <TreeIndent depth={depth} step="0.875rem">
          <Button
            type="button"
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={isOpen}
            variant="ghost"
            className={rowClass}
            onClick={() => {
              setExpanded((current) => {
                const next = new Set(current);
                if (isOpen) next.delete(category.id);
                else next.add(category.id);
                return next;
              });
              if (!isOpen && !branch) void loadBranch(category.id);
            }}
          >
            <ChevronRight aria-hidden className={cn(isOpen && "rotate-90")} />
            <Folder aria-hidden className="text-muted" />
            <span className="min-w-0 flex-1 break-words">{category.label}</span>
          </Button>
        </TreeIndent>
        {isOpen ? (
          <div role="group">
            {[
              ...children.map((item) => ({
                key: item.id,
                order: item.sortOrder,
                element: categoryRows(item, depth + 1),
              })),
              ...(branch?.items ?? []).map((item) => ({
                key: `character:${item.id}`,
                order: item.sortOrder ?? item.id,
                element: characterRow(item, depth + 1, category.id),
              })),
            ]
              .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
              .map((item) => item.element)}
            {branch?.loading ? (
              <p className="px-6 py-2 text-xs text-muted" role="status">
                加载中…
              </p>
            ) : null}
            {branch?.error || branch?.more ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={branch.loading}
                className="ml-6"
                onClick={() => void loadBranch(category.id, !branch.error)}
              >
                {branch.error ? "重试加载角色" : "更多角色"}
              </Button>
            ) : null}
            {branch &&
            !branch.loading &&
            !branch.error &&
            !branch.items.length &&
            !children.length ? (
              <p className="px-6 py-2 text-xs text-muted">暂无可用脸图</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
          aria-label="选择角色或全站热门"
        >
          {hot ? (
            <Flame aria-hidden className="text-muted" />
          ) : (
            <Folder aria-hidden className="text-muted" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={() => {
            if (tree.current) tree.current.scrollTop = scrollTop.current;
          }}
          className="z-[75] w-96 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-2 text-foreground shadow-surface"
        >
          <div className="relative mb-2">
            <Search
              aria-hidden
              className="absolute left-3 top-3 size-4 text-muted"
            />
            <Input
              aria-label="搜索角色"
              placeholder="搜索中文名、日文名或别名"
              className="pl-9"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOffset(0);
                setError("");
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "ArrowDown" &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  tree.current
                    ?.querySelector<HTMLButtonElement>('[role="treeitem"]')
                    ?.focus();
                }
              }}
            />
          </div>
          <div
            ref={tree}
            role="tree"
            aria-label="角色分类"
            className="max-h-[min(24rem,50dvh)] overflow-y-auto"
            onScroll={(event) => {
              scrollTop.current = event.currentTarget.scrollTop;
            }}
            onKeyDown={(event) => {
              const rows = Array.from(
                tree.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="treeitem"]',
                ) ?? [],
              );
              const index = rows.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              let next = index;
              if (event.key === "ArrowDown")
                next = Math.min(rows.length - 1, index + 1);
              else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = rows.length - 1;
              else if (
                (event.key === "ArrowRight" &&
                  rows[index].getAttribute("aria-expanded") === "false") ||
                (event.key === "ArrowLeft" &&
                  rows[index].getAttribute("aria-expanded") === "true")
              ) {
                event.preventDefault();
                rows[index].click();
                return;
              } else return;
              event.preventDefault();
              rows[next]?.focus();
            }}
          >
            <Button
              type="button"
              role="treeitem"
              aria-level={1}
              aria-selected={hot}
              variant="ghost"
              className={cn(
                rowClass,
                "mb-1",
                hot && "text-primary bg-primary/5",
              )}
              onClick={() => {
                onHot();
                setOpen(false);
                setQuery("");
                setOffset(0);
              }}
            >
              <Flame aria-hidden />
              <span className="flex-1">全站热门</span>
              {hot ? <Check aria-hidden /> : null}
            </Button>
            <div className="mb-1 border-t border-border" />
            {query.trim() ? (
              results.query === query ? (
                results.items.map((item) => characterRow(item))
              ) : null
            ) : (
              <>
                {categories
                  ?.filter((category) => category.parentId === null)
                  .map((category) => categoryRows(category))}
                {categories
                  ? categoryRows({
                      id: "",
                      parentId: null,
                      label: "未分类",
                      sortOrder: 0,
                    })
                  : null}
              </>
            )}
          </div>
          {(!categories && !error) ||
          (query.trim() && (searching || results.query !== query) && !error) ? (
            <p role="status" className="p-2 text-sm text-muted">
              加载中…
            </p>
          ) : null}
          {query.trim() &&
          results.query === query &&
          !searching &&
          !results.items.length ? (
            <p role="status" className="p-2 text-sm text-muted">
              没有匹配的角色
            </p>
          ) : null}
          {query.trim() && results.query === query && results.more ? (
            <Button
              type="button"
              variant="ghost"
              disabled={searching}
              onClick={() => setOffset(results.items.length)}
            >
              更多结果
            </Button>
          ) : null}
          {error ? (
            <div role="alert" className="p-2 text-sm">
              {error}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRetry((current) => current + 1)}
              >
                重试
              </Button>
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
