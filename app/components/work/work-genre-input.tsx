import { requestJsonValue } from "@/lib/ui/api-response";
import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { WORK_GENRE_MAX_LENGTH } from "@/lib/work-genre";
import { useEffect, useState } from "react";

export function WorkGenreInput({ id, value, disabled, onChange }: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<{ query: string | null; names: string[] }>({ query: null, names: [] });
  useEffect(() => {
    if (!focused || disabled || !value.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await requestJsonValue<{ names: string[] }>(`/api/genres?${new URLSearchParams({ q: value })}`, { signal: controller.signal }, "类型候补加载失败");
        if (!controller.signal.aborted) setSuggestions({ query: value, names: result.names });
      } catch {
        // Suggestions are optional; a failed request never blocks free text.
        if (!controller.signal.aborted) setSuggestions({ query: value, names: [] });
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, focused, disabled]);
  const hasQuery = Boolean(value.trim());
  const loading = hasQuery && suggestions.query !== value;
  const items = !hasQuery || loading ? [] : suggestions.names;
  return (
    <SearchComboBox
      id={id}
      label="类型"
      query={value}
      disabled={disabled}
      maxLength={WORK_GENRE_MAX_LENGTH}
      onQueryChange={onChange}
      onFocusChange={setFocused}
      inputSuffix={items.length > 0 ? undefined : false}
      items={items}
      getKey={(name) => name}
      getText={(name) => name}
      renderItem={(name) => <span>{name}</span>}
      onChoose={onChange}
    />
  );
}
