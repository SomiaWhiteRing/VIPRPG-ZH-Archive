import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import type { GameExternalLink } from "@/lib/dto/db/game-library";
import { useState } from "react";

export function ExternalLinkList({
  initialValues,
}: {
  initialValues: GameExternalLink[];
}) {
  const empty = { id: 0, label: "", url: "", linkType: "other" };
  const [values, setValues] = useState(
    initialValues.length ? initialValues : [empty],
  );
  const serialized = values
    .filter((item) => item.label || item.url)
    .map((item) =>
      [item.label, item.url, item.linkType].map(escapePart).join("|"),
    )
    .join("\n");
  function update(index: number, value: Partial<GameExternalLink>) {
    setValues((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...value } : item,
      ),
    );
  }
  return (
    <fieldset className="grid gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-semibold">外部链接</legend>
      <Textarea
        className="hidden"
        name="external_links"
        readOnly
        value={serialized}
      />
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
              { value: "download_page", label: "下载页" },
              { value: "other", label: "其他" },
            ]}
          />
          <Button
            onClick={() =>
              setValues((current) =>
                current.filter((_, itemIndex) => itemIndex !== index),
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
          setValues((current) => [...current, { ...empty, id: current.length }])
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

function escapePart(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
