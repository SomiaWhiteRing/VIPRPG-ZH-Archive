import { Button } from "@/app/components/ui/button";
import { ShowcaseImage } from "@/app/components/profile/showcase-image";
import {
  ComboboxOption,
  ComboboxOptions,
  handleComboboxNavigation,
} from "@/app/components/ui/combobox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  SHOWCASE_LABELS,
  type ShowcaseKind,
  type ShowcaseTarget,
} from "@/lib/showcase";
import { useEffect, useRef, useState } from "react";

export function ShowcaseTargetPicker({
  kind,
  selectedName,
  disabled,
  onChoose,
}: {
  kind: Exclude<ShowcaseKind, "character">;
  selectedName?: string;
  disabled: boolean;
  onChoose: (target: ShowcaseTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [result, setResult] = useState<{
    query: string;
    targets: ShowcaseTarget[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = `showcase-picker-${kind}`;
  const options = result?.query === query ? result.targets : [];
  const menuOpen = open && !disabled;

  useEffect(() => {
    if (!menuOpen) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ kind, q: query });
        const response = await fetch(`/api/account/showcase?${params}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          targets: ShowcaseTarget[];
          detail?: string;
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.detail || data.error || "搜索失败，请重试。");
        if (!controller.signal.aborted) {
          setResult({ query, targets: data.targets });
          setActiveIndex(0);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "搜索失败，请重试。",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [kind, menuOpen, query, retry]);

  function choose(target: ShowcaseTarget) {
    onChoose(target);
    inputRef.current?.focus();
    setOpen(false);
    setQuery("");
    setResult(null);
  }

  return (
    <div
      className="relative grid gap-1.5"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Label htmlFor={id}>选择{SHOWCASE_LABELS[kind]}</Label>
      <Input
        id={id}
        ref={inputRef}
        role="combobox"
        autoComplete="off"
        value={query}
        disabled={disabled}
        maxLength={100}
        placeholder={selectedName ?? `搜索${SHOWCASE_LABELS[kind]}名称或别名`}
        aria-autocomplete="list"
        aria-expanded={menuOpen}
        aria-controls={`${id}-options`}
        aria-activedescendant={
          menuOpen && !loading && !error && options[activeIndex]
            ? `${id}-option-${options[activeIndex].id}`
            : undefined
        }
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (
            handleComboboxNavigation(event, {
              count: loading || error ? 0 : options.length,
              open: menuOpen,
              activeIndex,
              setOpen,
              setActiveIndex,
            })
          )
            return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (menuOpen && !loading && !error && options[activeIndex])
              choose(options[activeIndex]);
          }
        }}
      />
      {menuOpen ? (
        <div className="relative">
          <ComboboxOptions
            id={`${id}-options`}
            activeIndex={activeIndex}
            aria-label={`${SHOWCASE_LABELS[kind]}搜索结果`}
            aria-busy={loading}
          >
            {loading ? (
              <p className="px-3 py-2 text-sm text-muted" role="status">
                正在搜索…
              </p>
            ) : error ? (
              <div className="grid gap-2 p-2">
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  重新搜索
                </Button>
              </div>
            ) : options.length ? (
              options.map((target, index) => (
                <ComboboxOption
                  id={`${id}-option-${target.id}`}
                  key={target.id}
                  selected={activeIndex === index}
                  className="h-auto min-h-16 justify-start gap-3 whitespace-normal"
                  onClick={() => choose(target)}
                >
                  <span
                    className="flex size-12 shrink-0 overflow-hidden"
                    aria-hidden="true"
                  >
                    <ShowcaseImage target={target} />
                  </span>
                  <span className="min-w-0 wrap-anywhere">{target.name}</span>
                </ComboboxOption>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-muted" role="status">
                没有找到可公开展示的{SHOWCASE_LABELS[kind]}。
              </p>
            )}
            {!loading && !error && options.length === 12 ? (
              <p className="px-3 py-2 text-xs text-muted">
                显示前 12 项，请补充名称缩小范围。
              </p>
            ) : null}
          </ComboboxOptions>
        </div>
      ) : null}
    </div>
  );
}
