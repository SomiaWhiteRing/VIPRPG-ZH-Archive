import { Input } from "@/app/components/ui/input";
import { WORK_GENRE_MAX_LENGTH } from "@/lib/work-genre";
import { useEffect, useId, useState } from "react";

export function WorkGenreInput({ id, value, disabled, onChange }: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<{ query: string; names: string[] }>({ query: "", names: [] });
  useEffect(() => {
    if (!focused || disabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/genres?${new URLSearchParams({ q: value })}`, { signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json() as { names: string[] };
        if (!controller.signal.aborted) setSuggestions({ query: value, names: result.names });
      } catch {
        // Suggestions are optional; a failed request never blocks free text.
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, focused, disabled]);
  return <>
    <Input id={id} value={value} disabled={disabled} list={listId}
      maxLength={WORK_GENRE_MAX_LENGTH}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={(event) => onChange(event.target.value)} />
    <datalist id={listId}>
      {(suggestions.query === value ? suggestions.names : []).map((name) => <option key={name} value={name} />)}
    </datalist>
  </>;
}
