import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import type {
  CharacterBrowseNode,
  CharacterCategory,
} from "@/lib/character-index";
import {
  buildCharacterBrowseTree,
  characterNodeDescendants,
  characterNodePath,
} from "@/lib/character-index";
import { cn } from "@/lib/ui/cn";
import { Check, ChevronDown, ChevronRight, Folder } from "lucide-react";
import { Popover } from "radix-ui";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

export function CategoryPicker({
  id,
  categories,
  categoryId = null,
  mode,
  value,
  disabled,
  onValueChange,
}: {
  id: string;
  categories: CharacterCategory[];
  categoryId?: string | null;
  mode: "parent" | "membership";
  value: string | null;
  disabled: boolean;
  onValueChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fieldLabel = mode === "parent" ? "上级分类" : "所属分类";
  const available = useMemo(() => {
    const excluded =
      mode === "parent" && categoryId
        ? characterNodeDescendants(categories, categoryId)
        : new Set<string>();
    return categories.filter((category) => !excluded.has(category.id));
  }, [categories, categoryId, mode]);
  const roots = useMemo(
    () =>
      buildCharacterBrowseTree(
        { categories: available, characters: [], memberships: [] },
        query.replace(/[/／]/g, " "),
      ).roots,
    [available, query],
  );
  const selectedPath = value
    ? characterNodePath(categories, value)
    : mode === "parent"
      ? "一级分类（无上级）"
      : "选择分类";
  const searching = Boolean(query.trim());

  function changeOpen(next: boolean) {
    if (next && disabled) return;
    setOpen(next);
    if (!next) return;
    setQuery("");
    const ancestors = new Set<string>();
    const byId = new Map(categories.map((category) => [category.id, category]));
    let current = value ? byId.get(value) : undefined;
    while (current && !ancestors.has(current.id)) {
      ancestors.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    setExpanded(ancestors);
  }

  function choose(next: string | null) {
    if (disabled || (mode === "membership" && next === null)) return;
    onValueChange(next);
    setOpen(false);
  }

  function renderNodes(nodes: CharacterBrowseNode[]): ReactNode {
    return nodes.map((node) => {
      if (node.kind !== "category") return null;
      const hasChildren = node.children.length > 0;
      const isExpanded = searching || expanded.has(node.id);
      const selected = value === node.id;
      return (
        <li key={node.id}>
          <div
            className={cn(
              "flex items-center rounded-sm",
              selected && "bg-primary/10",
            )}
          >
            {hasChildren ? (
              <Button
                type="button"
                variant="ghost"
                className="size-8 min-h-8 shrink-0 p-0"
                aria-label={`${isExpanded ? "收起" : "展开"}${node.label}`}
                aria-expanded={isExpanded}
                disabled={disabled || searching}
                onClick={() =>
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
              >
                <ChevronRight
                  aria-hidden
                  className={cn(isExpanded && "rotate-90")}
                />
              </Button>
            ) : (
              <span className="w-8 shrink-0" />
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-pressed={selected}
              className={cn(
                "min-w-0 flex-1 justify-start whitespace-normal px-2 py-2 text-left font-normal",
                selected && "text-primary",
              )}
              onClick={() => choose(node.id)}
            >
              <Folder aria-hidden />
              <span className="min-w-0 flex-1 break-words">{node.label}</span>
              {selected ? <Check aria-hidden /> : null}
            </Button>
          </div>
          {hasChildren && isExpanded ? (
            <ul className="ml-4 border-l border-border pl-2">
              {renderNodes(node.children)}
            </ul>
          ) : null}
        </li>
      );
    });
  }

  return (
    <Popover.Root open={open && !disabled} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full min-w-0 justify-between whitespace-normal text-left font-normal"
        >
          <span className="min-w-0 break-words">{selectedPath}</span>
          <ChevronDown aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          aria-label={`选择${fieldLabel}`}
          className="z-50 flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-border bg-card text-foreground shadow-surface"
        >
          <div className="grid gap-2 border-b border-border p-3">
            <Input
              type="search"
              aria-label={`搜索${fieldLabel}`}
              placeholder="搜索中文名、日文名或分类路径"
              value={query}
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
            <p className="break-words text-xs text-muted">
              当前选择：{selectedPath}
            </p>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-2">
            {mode === "parent" ? (
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                aria-pressed={value === null}
                className={cn(
                  "mb-1 w-full justify-start whitespace-normal text-left font-normal",
                  value === null && "bg-primary/10 text-primary",
                )}
                onClick={() => choose(null)}
              >
                <Folder aria-hidden />
                <span className="flex-1">一级分类（无上级）</span>
                {value === null ? <Check aria-hidden /> : null}
              </Button>
            ) : null}
            <ul
              aria-label={`可选${fieldLabel}`}
              className={cn(mode === "parent" && "border-t border-border pt-1")}
            >
              {renderNodes(roots)}
            </ul>
            {!roots.length ? (
              <p role="status" className="p-3 text-sm text-muted">
                {searching
                  ? "没有匹配的分类，请尝试其他名称。"
                  : `没有可选的${fieldLabel}。`}
              </p>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
