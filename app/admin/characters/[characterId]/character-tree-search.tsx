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
import { useId, useMemo, useRef, useState } from "react";
import {
  Collection,
  Tree,
  TreeItem,
  TreeItemContent,
  Button as TreeButton,
  type Key,
} from "react-aria-components";

type Node = {
  id: string;
  label: string;
  originalName?: string;
  characterId?: number;
  children: Node[];
  sortOrder: number;
};

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
  const tree = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<Key>>(new Set());
  const searching = Boolean(query.trim());
  const roots = useMemo(() => buildTree(data, query), [data, query]);
  const searchExpanded = new Set<Key>();
  function collect(nodes: Node[]) {
    for (const node of nodes) {
      if (node.children.length) searchExpanded.add(node.id);
      collect(node.children);
    }
  }
  if (searching) collect(roots);

  function changeOpen(next: boolean) {
    if (next && disabled) return;
    setOpen(next);
    if (!next || open) return;
    const ancestors = new Set<Key>();
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

  function renderNode(node: Node) {
    const category = node.characterId === undefined;
    const selected = node.characterId === characterId;
    return (
      <TreeItem
        id={node.id}
        textValue={node.label}
        onAction={() => {
          if (category) {
            if (!searching)
              setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              });
          } else {
            setOpen(false);
            if (!selected) onSelect(node.characterId!);
          }
        }}
        className="rounded-sm outline-none data-focused:bg-primary/10 data-focus-visible:ring-2 data-focus-visible:ring-primary/30"
      >
        <TreeItemContent>
          {({ level, isExpanded }) => (
            <TreeIndent depth={level - 1} step="0.875rem">
              <div
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-2 px-2 py-2 text-sm",
                  selected && "text-primary",
                )}
              >
                {category ? (
                  <>
                    <TreeButton
                      slot="chevron"
                      aria-label={`${isExpanded ? "收起" : "展开"}${node.label}`}
                      isDisabled={searching}
                      className="flex size-5 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn("size-4", isExpanded && "rotate-90")}
                      />
                    </TreeButton>
                    <Folder
                      aria-hidden
                      className="size-4 shrink-0 text-muted"
                    />
                  </>
                ) : (
                  <span className="w-5 shrink-0" />
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
                  <Check className="size-4" aria-hidden />
                ) : !category ? (
                  <span className="text-xs text-muted">
                    #{node.characterId}
                  </span>
                ) : null}
              </div>
            </TreeIndent>
          )}
        </TreeItemContent>
        <Collection items={node.children}>{renderNode}</Collection>
      </TreeItem>
    );
  }

  return (
    <Popover.Root open={open && !disabled} onOpenChange={changeOpen}>
      <Popover.Anchor asChild>
        <div
          ref={anchor}
          className="relative w-full sm:w-80"
          onKeyDownCapture={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
            if (
              !open &&
              ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)
            ) {
              event.preventDefault();
              changeOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-3 size-4 text-muted"
          />
          <Input
            ref={input}
            aria-label="搜索角色或分类"
            type="search"
            disabled={disabled}
            aria-controls={open ? treeId : undefined}
            placeholder="角色、别名、#ID 或分类"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              changeOpen(true);
            }}
            onFocus={() => changeOpen(true)}
            onClick={() => changeOpen(true)}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                !["ArrowDown", "ArrowUp"].includes(event.key)
              )
                return;
              event.preventDefault();
              const rows =
                tree.current?.querySelectorAll<HTMLElement>('[role="row"]');
              const row =
                event.key === "ArrowDown" ? rows?.[0] : rows?.[rows.length - 1];
              row?.focus();
            }}
            className="pl-9 pr-18"
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
          onEscapeKeyDown={() => input.current?.focus()}
          onInteractOutside={(event) => {
            if (
              event.target instanceof globalThis.Node &&
              anchor.current?.contains(event.target)
            )
              event.preventDefault();
          }}
          className="z-50 max-h-[min(28rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border border-border bg-card p-2 text-foreground shadow-surface"
        >
          <Tree
            ref={tree}
            id={treeId}
            aria-label="角色分类"
            items={roots}
            selectionMode="none"
            expandedKeys={searching ? searchExpanded : expanded}
            onExpandedChange={(keys) => {
              if (!searching) setExpanded(new Set(keys));
            }}
            renderEmptyState={() => (
              <p role="status" className="p-3 text-sm text-muted">
                没有匹配的角色或分类
              </p>
            )}
            className="min-w-0 outline-none"
          >
            {renderNode}
          </Tree>
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
