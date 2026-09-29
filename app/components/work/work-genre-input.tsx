import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { WORK_GENRE_MAX_LENGTH } from "@/lib/work-genre";
import { useEffect, useState } from "react";

export function WorkGenreInput({ id, value, disabled, onChange }: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ query: string | null; names: string[] }>({ query: null, names: [] });
  useEffect(() => {
    if (!open || disabled || !value.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/genres?${new URLSearchParams({ q: value })}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Genre suggestions unavailable");
        const result = await response.json() as { names: string[] };
        if (!controller.signal.aborted) setSuggestions({ query: value, names: result.names });
      } catch {
        // Suggestions are optional; a failed request never blocks free text.
        if (!controller.signal.aborted) setSuggestions({ query: value, names: [] });
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, open, disabled]);
  const hasQuery = Boolean(value.trim());
  const loading = hasQuery && suggestions.query !== value;
  return (
    <SearchComboBox
      id={id}
      label="类型"
      query={value}
      disabled={disabled}
      maxLength={WORK_GENRE_MAX_LENGTH}
      onQueryChange={onChange}
      onOpenChange={setOpen}
      items={!hasQuery || loading ? [] : suggestions.names}
      getKey={(name) => name}
      getText={(name) => name}
      renderItem={(name) => <span>{name}</span>}
      onChoose={onChange}
      loading={loading}
      emptyState={hasQuery ? <span className="px-2.5 py-1.5 text-sm text-muted">{loading ? "加载中…" : "暂无候补"}</span> : null}
    />
  );
}
