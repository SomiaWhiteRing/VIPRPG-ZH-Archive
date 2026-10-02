import { TokenPicker } from "@/app/components/pickers/token-picker";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import type { UploadTaxonomySuggestion } from "@/app/upload/upload-types";
import { normalizeEntityName } from "@/lib/entity-name";
import { MAX_PUBLIC_TAGS, NON_VIPRPG_TAG, tagNameKey } from "@/lib/user-tags";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";

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
  const confirm = useConfirm();
  const pending = useRef(false);
  const latest = useRef({ disabled, values });
  useEffect(() => { latest.current = { disabled, values }; }, [disabled, values]);
  const tagSuggestions = useMemo(() => {
    // The popular-tag query may omit this tag, including on a new installation.
    const pinned = suggestions.find((tag) => isNonViprpg(tag.value)) ?? {
      value: NON_VIPRPG_TAG,
      meta: "请使用外链提交",
    };
    return [pinned, ...suggestions.filter((tag) => !isNonViprpg(tag.value))];
  }, [suggestions]);

  async function changeTags(next: string[]) {
    if (disabled || pending.current) return;
    if (values.some(isNonViprpg) || !next.some(isNonViprpg)) {
      onChange(next);
      return;
    }
    pending.current = true;
    try {
      const accepted = await confirm(
        "非VIPRPG作品请使用外链提交。大量非共享素材会占用本站存储空间，相关归档可能被清理，且不会提前通知。带有此标签的作品也不会在首页展示。",
        {
          title: "非VIPRPG作品收录提醒",
          confirmLabel: "了解，继续选择",
          content: (
            <Link className="text-sm font-bold text-primary underline underline-offset-4"
              to="/about#non-viprpg-storage" target="_blank" rel="noreferrer">
              查看非VIPRPG作品归档清理说明（新窗口）
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
      label="标签"
      maxValues={MAX_PUBLIC_TAGS}
      normalizeValue={normalizeEntityName}
      onChange={(next) => void changeTags(next)}
      pinnedValue={tagSuggestions[0].value}
      placeholder="搜索或创建标签"
      recommendationLabel="推荐标签"
      sortable
      suggestions={tagSuggestions}
      values={values}
    />
  );
}
