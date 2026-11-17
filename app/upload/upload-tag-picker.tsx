import { TokenPicker } from "@/app/components/pickers/token-picker";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import type { UploadTaxonomySuggestion } from "@/app/upload/upload-types";
import { normalizeEntityName } from "@/lib/entity-name";
import { MAX_PUBLIC_TAGS, NON_VIPRPG_TAG, tagNameKey } from "@/lib/user-tags";
import { useEffect, useMemo, useRef } from "react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";

const nonViprpgKey = tagNameKey(NON_VIPRPG_TAG);
const isNonViprpg = (value: string) => tagNameKey(value) === nonViprpgKey;

export function UploadTagPicker({
  disabled,
  suggestions,
  values,
  onChange,
}: {
  disabled: boolean;
  suggestions: UploadTaxonomySuggestion[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const t = useMessages();
  const confirm = useConfirm();
  const pending = useRef(false);
  const latest = useRef({ disabled, values });
  useEffect(() => { latest.current = { disabled, values }; }, [disabled, values]);
  const tagSuggestions = useMemo(() => {
    // The popular-tag query may omit this tag, including on a new installation.
    const pinned = suggestions.find((tag) => isNonViprpg(tag.value)) ?? {
      value: NON_VIPRPG_TAG,
      meta: t("upload.tag.external"),
    };
    return [pinned, ...suggestions.filter((tag) => !isNonViprpg(tag.value))];
  }, [suggestions, t]);

  async function changeTags(next: string[]) {
    if (disabled || pending.current) return;
    if (values.some(isNonViprpg) || !next.some(isNonViprpg)) {
      onChange(next);
      return;
    }
    pending.current = true;
    try {
      const accepted = await confirm(
        t("upload.tag.policy"),
        {
          title: t("upload.tag.policyTitle"),
          confirmLabel: t("upload.tag.accept"),
          content: (
            <Link className="text-sm font-bold text-primary underline underline-offset-4"
              to="/about#non-viprpg-storage" target="_blank" rel="noreferrer">
              {t("upload.tag.policyLink")}
            </Link>
          ),
        },
      );
      // Ignore a stale confirmation if a draft was restored or editing was locked.
      if (accepted && !latest.current.disabled && latest.current.values === values) onChange(next);
    } finally {
      pending.current = false;
    }
  }

  return (
    <TokenPicker
      disabled={disabled}
      id="upload-tags"
      label={t("upload.metadata.tags")}
      maxValues={MAX_PUBLIC_TAGS}
      normalizeValue={normalizeEntityName}
      onChange={(next) => void changeTags(next)}
      pinnedValue={tagSuggestions[0].value}
      placeholder={t("upload.metadata.tagSearch")}
      recommendationLabel={t("upload.metadata.tagRecommendations")}
      sortable
      suggestions={tagSuggestions}
      values={values}
    />
  );
}
