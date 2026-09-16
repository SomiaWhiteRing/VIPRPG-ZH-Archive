import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { TreeIndent } from "@/app/components/ui/tree-layout";
import type { CharacterIndexData } from "@/lib/character-index";
import {
  characterMembershipNames,
  sortCharacterNodes,
} from "@/lib/character-index";
import { characterNameKey } from "@/lib/character-names";
import { cn } from "@/lib/ui/cn";
import { Check, ChevronRight, Folder, ListTree, Search, X } from "lucide-react";
import { Popover } from "radix-ui";
import type { KeyboardEvent } from "react";
import { useId, useMemo, useRef, useState } from "react";

type Node = {
  id: string;
  label: string;
  originalName?: string;
  characterId?: number;
  children: Node[];
  sortOrder: number;
};
type Row = { node: Node; depth: number; parentId: string | null };

export function CharacterTreeSearch({
  data,
  characterId,
  disabled,
  onSelect,
}: {
  data: CharacterIndexData;
  characterId: number;
  disabled: boolean;
  onSelect: (id: number) => void;
}) {
  const treeId = useId();
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const searching = Boolean(query.trim());
  const roots = useMemo(() => buildTree(data, query), [data, query]);
  const rows: Row[] = [];
  function flatten(nodes: Node[], depth: number, parentId: string | null) {
    for (const node of nodes) {
      rows.push({ node, depth, parentId });
      if (searching || expanded.has(node.id))
        flatten(node.children, depth + 1, node.id);
    }
  }
  flatten(roots, 0, null);
  const activeIndex = Math.max(
    0,
    rows.findIndex(({ node }) => node.id === activeId),
  );
  const active = rows[activeIndex];

  function changeOpen(next: boolean) {
    if (next && disabled) return;
    setOpen(next);
    if (!next || open) return;
    const ancestors = new Set<string>();
    const categories = new Map(
      data.categories.map((category) => [category.id, category]),
    );
    for (const membership of data.memberships.filter(
      (item) => item.characterId === characterId,
    )) {
      let category = categories.get(membership.categoryId);
      while (category && !ancestors.has(category.id)) {
        ancestors.add(category.id);
        category = category.parentId
          ? categories.get(category.parentId)
          : undefined;
      }
    }
    setExpanded(ancestors);
  }

  function toggle(node: Node) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }

  function choose(node: Node) {
    if (disabled) return;
    if (node.characterId !== undefined) {
      setOpen(false);
      if (node.characterId !== characterId) onSelect(node.characterId);
    } else if (!searching) toggle(node);
  }

  function focusRow(index: number) {
    const row = rows[index];
    if (!row) return;
    setActiveId(row.node.id);
    document
      .getElementById(`${treeId}-${row.node.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (
      !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Enter"].includes(
        event.key,
      )
    )
      return;
    event.preventDefault();
    if (!open) {
      changeOpen(true);
      return;
    }
    if (!active) return;
    if (event.key === "ArrowDown")
      focusRow(Math.min(rows.length - 1, activeIndex + 1));
    if (event.key === "ArrowUp") focusRow(Math.max(0, activeIndex - 1));
    if (event.key === "Enter") choose(active.node);
    if (event.key === "ArrowRight" && active.node.characterId === undefined) {
      if (!searching && !expanded.has(active.node.id)) toggle(active.node);
      else if (active.node.children.length) focusRow(activeIndex + 1);
    }
    if (event.key === "ArrowLeft") {
      if (!searching && expanded.has(active.node.id)) toggle(active.node);
      else focusRow(rows.findIndex(({ node }) => node.id === active.parentId));
    }
  }

  return (
    <Popover.Root open={open && !disabled} onOpenChange={changeOpen}>
      <Popover.Anchor asChild>
        <div ref={anchor} className="relative w-full sm:w-80">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-3 size-4 text-muted"
          />
          <Input
            ref={input}
            aria-label="搜索角色或分类"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="tree"
            aria-controls={treeId}
            aria-expanded={open && !disabled}
            aria-activedescendant={
              open && active ? `${treeId}-${active.node.id}` : undefined
            }
            className="pl-9 pr-18"
            disabled={disabled}
            type="text"
            placeholder="角色、别名、#ID 或分类"
            value={query}
            onFocus={() => changeOpen(true)}
            onClick={() => changeOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveId(null);
              changeOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
          {query ? (
            <Button
              aria-label="清空角色搜索"
              className="absolute right-9 top-1 size-8 min-h-0"
              size="icon"
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setQuery("");
                setActiveId(null);
                input.current?.focus();
              }}
            >
              <X />
            </Button>
          ) : null}
          <Button
            aria-label="角色分类树"
            aria-expanded={open && !disabled}
            aria-controls={treeId}
            title="角色分类树"
            className="absolute right-1 top-1 size-8 min-h-0"
            disabled={disabled}
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => {
              input.current?.focus();
              changeOpen(!open);
            }}
          >
            <ListTree />
          </Button>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          aria-label="角色分类搜索"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (
              event.target instanceof Node &&
              anchor.current?.contains(event.target)
            )
              event.preventDefault();
          }}
          className="z-50 max-h-[min(28rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border border-border bg-card p-2 text-foreground shadow-surface"
        >
          <div
            id={treeId}
            role="tree"
            aria-label="角色分类"
            className="min-w-0"
          >
            {rows.map(({ node, depth }, index) => {
              const category = node.characterId === undefined;
              const selected = node.characterId === characterId;
              const isExpanded = searching || expanded.has(node.id);
              return (
                <TreeIndent depth={depth} step="0.875rem" key={node.id}>
                  <Button
                    id={`${treeId}-${node.id}`}
                    role="treeitem"
                    aria-level={depth + 1}
                    aria-selected={selected}
                    aria-expanded={category ? isExpanded : undefined}
                    tabIndex={-1}
                    type="button"
                    variant="ghost"
                    className={cn(
                      "h-auto w-full min-w-0 justify-start gap-2 whitespace-normal rounded-sm px-2 py-2 text-left font-normal",
                      index === activeIndex && "bg-muted/10",
                      selected && "text-primary",
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveId(node.id)}
                    onClick={() => choose(node)}
                  >
                    {category ? (
                      <>
                        <ChevronRight
                          aria-hidden
                          className={cn(isExpanded && "rotate-90")}
                        />
                        <Folder aria-hidden className="text-muted" />
                      </>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 break-words">
                      {node.label}
                      {node.originalName && node.originalName !== node.label ? (
                        <span className="block text-xs text-muted">
                          {node.originalName}
                        </span>
                      ) : null}
                    </span>
                    {selected ? (
                      <Check aria-hidden />
                    ) : node.characterId !== undefined ? (
                      <span className="shrink-0 text-xs text-muted">
                        #{node.characterId}
                      </span>
                    ) : null}
                  </Button>
                </TreeIndent>
              );
            })}
          </div>
          {!rows.length ? (
            <p role="status" className="p-3 text-sm text-muted">
              没有匹配的角色或分类
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function buildTree(data: CharacterIndexData, query: string): Node[] {
  const terms = characterNameKey(query.replace(/[/／]/g, " "))
    .split(/\s+/)
    .filter(Boolean);
  const characters = new Map(
    data.characters.map((character) => [character.id, character]),
  );
  const matches = (text: string, id?: number) =>
    terms.every((term) =>
      /^#\d+$/.test(term)
        ? id !== undefined && String(id) === term.slice(1)
        : characterNameKey(text).includes(term),
    );
  const characterNode = (
    id: number,
    context: string,
    membership?: CharacterIndexData["memberships"][number],
  ): Node[] => {
    const character = characters.get(id);
    if (!character) return [];
    const names = characterMembershipNames(character, membership);
    if (
      !matches(
        `${context} ${names.displayName} ${names.originalName} ${character.primaryName} ${character.originalName} ${character.aliases.map((alias) => alias.name).join(" ")}`,
        id,
      )
    )
      return [];
    return [
      {
        id: `character:${membership?.categoryId ?? "unclassified"}:${id}`,
        characterId: id,
        label: names.displayName,
        originalName: names.originalName,
        sortOrder: membership?.sortOrder ?? id,
        children: [],
      },
    ];
  };
  const collect = (
    parent: string | null,
    context: string,
    visited: Set<string>,
  ): Node[] => {
    const nodes: Node[] = [];
    for (const category of data.categories.filter(
      (item) => item.parentId === parent,
    )) {
      if (visited.has(category.id)) continue;
      const path = `${context} ${category.label} ${category.originalName ?? ""}`;
      const children = collect(
        category.id,
        path,
        new Set([...visited, category.id]),
      );
      if (children.length || matches(path))
        nodes.push({
          ...category,
          originalName: category.originalName ?? undefined,
          children,
        });
    }
    for (const membership of data.memberships.filter(
      (item) => item.categoryId === parent,
    ))
      nodes.push(...characterNode(membership.characterId, context, membership));
    return sortCharacterNodes(nodes);
  };
  const roots = collect(null, "", new Set());
  const classified = new Set(
    data.memberships.map((membership) => membership.characterId),
  );
  const unclassified = data.characters
    .filter((character) => !classified.has(character.id))
    .flatMap((character) => characterNode(character.id, "未分类"));
  if (unclassified.length)
    roots.push({
      id: "unclassified",
      label: "未分类",
      children: unclassified,
      sortOrder: roots.length,
    });
  return roots;
}
