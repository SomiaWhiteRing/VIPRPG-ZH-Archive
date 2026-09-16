import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import type { CustomEmojiDto } from "@/lib/dto/db/work-community";
import { cn } from "@/lib/ui/cn";

export function EmojiGrid({
  emojis,
  onSelect,
  compact = false,
}: {
  emojis: CustomEmojiDto[];
  onSelect: (shortcode: string) => void;
  compact?: boolean;
}) {
  const available = emojis.filter(
    (emoji) => emoji.status === "active" && emoji.visibleInPicker,
  );
  return (
    <div
      className={cn(
        "grid grid-cols-6 gap-2",
        compact && "max-h-56 gap-1 overflow-y-auto",
      )}
    >
      {available.map((emoji) => (
        <Button
          key={emoji.id}
          type="button"
          variant="ghost"
          className={compact ? "grid h-9 w-9 p-0" : "h-12"}
          aria-label={`插入 :${emoji.shortcode}:`}
          title={emoji.name}
          onClick={() => onSelect(emoji.shortcode)}
        >
          <img
            alt={emoji.name}
            height={24}
            width={24}
            src={emoji.imageUrl}
            loading="lazy"
          />
        </Button>
      ))}
      {!available.length ? (
        <EmptyState
          title="暂无站点表情。"
          variant="plain"
          className="col-span-6 p-2"
        />
      ) : null}
    </div>
  );
}
