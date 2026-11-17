import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { formatFeedbackError } from "@/lib/i18n/feedback";
import { requestJson } from "@/lib/ui/api-response";

import { Button } from "@/app/components/ui/button";
import { ShowcaseImage } from "@/app/components/profile/showcase-image";
import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { Label } from "@/app/components/ui/label";
import { type ShowcaseKind, type ShowcaseTarget } from "@/lib/showcase";
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
  const t = useMessages();
  const locale = useUiLocale();
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
        const params = new URLSearchParams({ kind, q: query, [UI_LOCALE_PARAM]: locale });

        const data = (await requestJson(`/api/account/showcase?${params}`, {
          signal: controller.signal,
        })) as {
          targets: ShowcaseTarget[];
          detail?: string;
          error?: string;
        };

        if (!controller.signal.aborted) {
          setResult({ query, targets: data.targets });
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            formatFeedbackError(error, locale, t("showcase.picker.failed")),
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [kind, menuOpen, query, retry, locale, t]);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{t("showcase.picker.pick", { kind })}</Label>
      <SearchComboBox
        id={id}
        label={t("showcase.picker.pick", { kind })}
        query={query}
        onQueryChange={setQuery}
        onOpenChange={setOpen}
        disabled={disabled}
        loading={loading}
        maxLength={100}
        items={loading || error ? [] : options}
        getKey={(target) => target.id}
        getText={(target) => target.name}
        placeholder={selectedName ?? t("showcase.picker.search", { kind })}
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
              ? t("showcase.picker.searching")
              : error || t("showcase.picker.empty", { kind })}
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
                {t("showcase.picker.retry")}
              </Button>
            ) : null}
          </>
        }
      />
    </div>
  );
}
