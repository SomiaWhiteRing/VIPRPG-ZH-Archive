import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { Button } from "@/app/components/ui/button";
import { useId, useMemo, useState } from "react";

type MergeCandidate = {
  id: number;
  originalName: string;
  primaryName: string;
  workCount: number;
};

const RESULT_LIMIT = 50;

export function CharacterMergeTargetField({
  id: providedId,
  candidates,
  descriptionId,
  name,
}: {
  id?: string;
  candidates: MergeCandidate[];
  descriptionId?: string;
  name: string;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MergeCandidate | null>(null);
  const matches = useMemo(
    () => matchCandidates(candidates, query),
    [candidates, query],
  );

  function choose(candidate: MergeCandidate) {
    setSelected(candidate);
    setQuery("");
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    setSelected(null);
  }

  return (
    <div className="grid gap-2">
      <input name={name} readOnly type="hidden" value={selected?.id ?? ""} />
      <SearchComboBox
        id={id}
        label="目标角色"
        query={query}
        onQueryChange={changeQuery}
        placeholder="输入角色原名、译名或 #ID"
        descriptionId={descriptionId}
        items={matches.items}
        getKey={(item) => item.id}
        getText={(item) => `${item.originalName} · ${item.primaryName}`}
        onChoose={choose}
        enterSelectsFirst
        emptyState={
          query.trim() ? (
            <p className="p-2 text-sm text-muted" role="status">
              没有匹配角色
            </p>
          ) : undefined
        }
        footer={
          matches.total > RESULT_LIMIT ? (
            <p
              className="border-t border-border p-2 text-xs text-muted"
              role="status"
            >
              匹配 {matches.total} 个，显示前 {RESULT_LIMIT} 个
            </p>
          ) : null
        }
        renderItem={(candidate) => (
          <>
            <span className="min-w-0 truncate">
              {candidate.originalName} · {candidate.primaryName}
            </span>
            <span className="shrink-0 text-xs text-muted">
              #{candidate.id} · {candidate.workCount} 部作品
            </span>
          </>
        )}
      />
      {selected ? (
        <div className="flex min-h-10 items-center justify-between gap-3 border-y border-border py-2">
          <span className="min-w-0 truncate text-sm font-normal">
            已选择：{selected.originalName} · {selected.primaryName}
            <span className="ml-2 text-xs text-muted">
              #{selected.id} · {selected.workCount} 部作品
            </span>
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
        <span className="text-xs font-normal text-muted" role="status">
          当前不合并
        </span>
      )}
    </div>
  );
}

function matchCandidates(
  candidates: MergeCandidate[],
  rawQuery: string,
): {
  items: MergeCandidate[];
  total: number;
} {
  const query = normalizeSearch(rawQuery);
  if (!query) return { items: [], total: 0 };
  const terms = query.split(" ").filter(Boolean);
  const ranked = candidates
    .flatMap((candidate) => {
      const fields = [
        String(candidate.id),
        `#${candidate.id}`,
        normalizeSearch(candidate.originalName),
        normalizeSearch(candidate.primaryName),
      ];
      if (!terms.every((term) => fields.some((field) => field.includes(term))))
        return [];
      const rank = fields.includes(query)
        ? 0
        : fields.some((field) => field.startsWith(query))
          ? 1
          : 2;
      return [{ candidate, rank }];
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        right.candidate.workCount - left.candidate.workCount ||
        left.candidate.originalName.localeCompare(
          right.candidate.originalName,
          "ja",
        ),
    );
  return {
    items: ranked.slice(0, RESULT_LIMIT).map(({ candidate }) => candidate),
    total: ranked.length,
  };
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ja")
    .replace(/\s+/g, " ");
}
