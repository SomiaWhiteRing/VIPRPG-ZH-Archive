import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import type { GameExternalLink } from "@/lib/dto/db/game-library";

type ExternalLink = Pick<GameExternalLink, "label" | "url" | "linkType">;

export function ExternalLinkList({
  values,
  onChange,
}: {
  values: ExternalLink[];
  onChange: (values: ExternalLink[]) => void;
}) {
  const empty = { label: "", url: "", linkType: "other" };
  function update(index: number, value: Partial<ExternalLink>) {
    onChange(
      values.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...value } : item,
      ),
    );
  }
  return (
    <fieldset className="grid gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-semibold">外部链接</legend>
      {values.map((link, index) => (
        <div
          className="grid gap-2 border-b border-border pb-3 last:border-0 last:pb-0 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_160px_auto]"
          key={index}
        >
          <Input
            aria-label={"链接 " + (index + 1) + " 名称"}
            placeholder="名称"
            value={link.label}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <Input
            aria-label={"链接 " + (index + 1) + " 网址"}
            placeholder="https://"
            type="url"
            value={link.url}
            onChange={(event) => update(index, { url: event.target.value })}
          />
          <SelectField
            aria-label={"链接 " + (index + 1) + " 类型"}
            value={link.linkType}
            onValueChange={(value) => update(index, { linkType: value })}
            options={[
              { value: "official", label: "官方网站" },
              { value: "wiki", label: "Wiki" },
              { value: "source", label: "来源" },
              { value: "video", label: "视频" },
              { value: "other", label: "其他" },
            ]}
          />
          <Button
            onClick={() =>
              onChange(
                values.filter((_, itemIndex) => itemIndex !== index),
              )
            }
            type="button"
            variant="ghost"
          >
            删除
          </Button>
        </div>
      ))}
      <Button
        className="w-fit"
        onClick={() =>
          onChange([...values, empty])
        }
        size="sm"
        type="button"
        variant="outline"
      >
        添加链接
      </Button>
    </fieldset>
  );
}

export function serializeExternalLinks(values: ExternalLink[]): string {
  return values.filter((item) => item.label || item.url)
    .map((item) => [item.label, item.url, item.linkType].map(escapePart).join("|"))
    .join("\n");
}

function escapePart(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
