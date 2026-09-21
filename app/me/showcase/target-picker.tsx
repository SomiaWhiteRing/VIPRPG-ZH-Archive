import { Button } from "@/app/components/ui/button";
import { ShowcaseImage } from "@/app/components/profile/showcase-image";
import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { Label } from "@/app/components/ui/label";
import {
  SHOWCASE_LABELS,
  type ShowcaseKind,
  type ShowcaseTarget,
} from "@/lib/showcase";
import { useEffect, useState } from "react";

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
  const [result, setResult] = useState<{
    query: string;
    targets: ShowcaseTarget[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
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

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>选择{SHOWCASE_LABELS[kind]}</Label>
      <SearchComboBox
        id={id}
        label={`选择${SHOWCASE_LABELS[kind]}`}
        query={query}
        onQueryChange={setQuery}
        onOpenChange={setOpen}
        disabled={disabled}
        loading={loading}
        maxLength={100}
        items={loading || error ? [] : options}
        getKey={(target) => target.id}
        getText={(target) => target.name}
        placeholder={selectedName ?? `搜索${SHOWCASE_LABELS[kind]}名称或别名`}
        onChoose={(target) => {
          onChoose(target);
          setQuery("");
          setResult(null);
        }}
        itemClassName="min-h-16 justify-start"
        renderItem={(target) => (
          <>
            <span
              className="flex size-12 shrink-0 overflow-hidden"
              aria-hidden="true"
            >
              <ShowcaseImage target={target} />
            </span>
            <span className="min-w-0 wrap-anywhere">{target.name}</span>
          </>
        )}
        emptyState={
          <p
            className="px-3 py-2 text-sm text-muted"
            role={error ? "alert" : "status"}
          >
            {loading
              ? "正在搜索…"
              : error || `没有找到可公开展示的${SHOWCASE_LABELS[kind]}。`}
          </p>
        }
        footer={
          <>
            {error && !loading ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="m-2"
                onClick={() => setRetry((current) => current + 1)}
              >
                重新搜索
              </Button>
            ) : null}
            {!loading && !error && options.length === 12 ? (
              <p className="p-2 text-xs text-muted">
                显示前 12 项，请补充名称缩小范围。
              </p>
            ) : null}
          </>
        }
      />
    </div>
  );
}
