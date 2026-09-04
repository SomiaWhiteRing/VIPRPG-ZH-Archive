"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/lib/ui/cn";

type MergeCandidate = {
  id: number;
  originalName: string;
  primaryName: string;
  workCount: number;
};

const RESULT_LIMIT = 50;

export function CharacterMergeTargetField({
  candidates,
  descriptionId,
  name,
}: {
  candidates: MergeCandidate[];
  descriptionId?: string;
  name: string;
}) {
  const id = useId();
  const listId = `${id}-matches`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<MergeCandidate | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const matches = useMemo(() => matchCandidates(candidates, query), [candidates, query]);

  useEffect(() => {
    if (open) activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function choose(candidate: MergeCandidate) {
    setSelected(candidate);
    setQuery("");
    setActiveIndex(0);
    setOpen(false);
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    setSelected(null);
    setActiveIndex(0);
    setOpen(Boolean(normalizeSearch(nextQuery)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && matches.items.length) {
      event.preventDefault();
      setActiveIndex((current) => open ? (current + 1) % matches.items.length : 0);
      setOpen(true);
      return;
    }
    if (event.key === "ArrowUp" && matches.items.length) {
      event.preventDefault();
      setActiveIndex((current) => open
        ? (current - 1 + matches.items.length) % matches.items.length
        : matches.items.length - 1);
      setOpen(true);
      return;
    }
    if (event.key === "Enter" && normalizeSearch(query)) {
      event.preventDefault();
      if (open && matches.items[activeIndex]) choose(matches.items[activeIndex]);
      else setOpen(true);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  return (
    <div className="grid gap-2" onBlur={onBlur}>
      <input name={name} readOnly type="hidden" value={selected?.id ?? ""} />
      <div className="relative">
        <Input
          aria-activedescendant={open && matches.items[activeIndex] ? `${listId}-${matches.items[activeIndex].id}` : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={descriptionId}
          aria-expanded={open}
          aria-label="目标角色"
          onChange={(event) => changeQuery(event.target.value)}
          onFocus={() => setOpen(Boolean(normalizeSearch(query)))}
          onKeyDown={onKeyDown}
          placeholder="输入角色原名、译名或 #ID"
          role="combobox"
          type="search"
          value={query}
        />
        {open ? (
          <div
            className="absolute inset-x-0 top-[calc(100%+0.25rem)] z-30 max-h-72 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-surface"
            id={listId}
            role="listbox"
          >
            {matches.items.length ? matches.items.map((candidate, index) => (
              <Button
                aria-selected={index === activeIndex}
                className={cn(
                  "flex min-h-11 w-full justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left text-sm font-normal",
                  index === activeIndex && "bg-primary/10 text-primary",
                )}
                id={`${listId}-${candidate.id}`}
                key={candidate.id}
                onClick={() => choose(candidate)}
                onMouseDown={(event) => event.preventDefault()}
                ref={index === activeIndex ? activeOptionRef : undefined}
                role="option"
                type="button"
                variant="ghost"
              >
                <span className="min-w-0 truncate">{candidate.originalName} · {candidate.primaryName}</span>
                <span className="shrink-0 text-xs text-muted">#{candidate.id} · {candidate.workCount} 部作品</span>
              </Button>
            )) : (
              <p className="m-0 px-2.5 py-2 text-sm text-muted" role="status">没有匹配角色</p>
            )}
            {matches.total > RESULT_LIMIT ? (
              <p className="m-0 border-t border-border px-2.5 py-2 text-xs text-muted" role="status">
                匹配 {matches.total} 个，显示前 {RESULT_LIMIT} 个
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {selected ? (
        <div className="flex min-h-10 items-center justify-between gap-3 border-y border-border py-2">
          <span className="min-w-0 truncate text-sm font-normal">
            已选择：{selected.originalName} · {selected.primaryName}
            <span className="ml-2 text-xs text-muted">#{selected.id} · {selected.workCount} 部作品</span>
          </span>
          <Button
            aria-label={`清除目标角色 ${selected.originalName} · ${selected.primaryName}`}
            onClick={() => setSelected(null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            清除
          </Button>
        </div>
      ) : (
        <span className="text-xs font-normal text-muted" role="status">当前不合并</span>
      )}
    </div>
  );
}

function matchCandidates(candidates: MergeCandidate[], rawQuery: string): {
  items: MergeCandidate[];
  total: number;
} {
  const query = normalizeSearch(rawQuery);
  if (!query) return { items: [], total: 0 };
  const terms = query.split(" ").filter(Boolean);
  const ranked = candidates.flatMap((candidate) => {
    const fields = [
      String(candidate.id),
      `#${candidate.id}`,
      normalizeSearch(candidate.originalName),
      normalizeSearch(candidate.primaryName),
    ];
    if (!terms.every((term) => fields.some((field) => field.includes(term)))) return [];
    const rank = fields.includes(query)
      ? 0
      : fields.some((field) => field.startsWith(query))
        ? 1
        : 2;
    return [{ candidate, rank }];
  }).sort((left, right) =>
    left.rank - right.rank ||
    right.candidate.workCount - left.candidate.workCount ||
    left.candidate.originalName.localeCompare(right.candidate.originalName, "ja"),
  );
  return {
    items: ranked.slice(0, RESULT_LIMIT).map(({ candidate }) => candidate),
    total: ranked.length,
  };
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ja").replace(/\s+/g, " ");
}
