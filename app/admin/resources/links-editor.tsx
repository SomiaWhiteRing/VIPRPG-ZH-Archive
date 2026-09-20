import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import type { ResourceLink } from "@/lib/resources";

export function ResourceLinksEditor({ initial, disabled }: {
  initial: ResourceLink[];
  disabled: boolean;
}) {
  const [links, setLinks] = useState(initial);
  function update(index: number, field: keyof ResourceLink, value: string) {
    setLinks(links.map((link, i) => i === index ? { ...link, [field]: value } : link));
  }
  function move(index: number, offset: number) {
    const next = [...links];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setLinks(next);
  }
  return (
    <section className="grid gap-3" aria-label="网站按钮">
      <h3 className="font-bold">网站按钮</h3>
      <p className="text-sm text-muted">每个地址显示为独立按钮，支持网页和应用协议链接。</p>
      <input type="hidden" name="linksJson" value={JSON.stringify(links)} />
      {links.map((link, index) => (
        <div key={index} className="grid gap-3 rounded-md border border-border p-3">
          <Label className="grid gap-2">
            按钮文案
            <Input value={link.label} onChange={(e) => update(index, "label", e.target.value)} required disabled={disabled} />
          </Label>
          <Label className="grid gap-2">
            访问地址
            <Input type="url" value={link.url} onChange={(e) => update(index, "url", e.target.value)} required maxLength={2048} disabled={disabled} />
          </Label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled || index === 0} onClick={() => move(index, -1)}>上移</Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled || index === links.length - 1} onClick={() => move(index, 1)}>下移</Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setLinks(links.filter((_, i) => i !== index))}>移除</Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" className="justify-self-start" disabled={disabled}
        onClick={() => setLinks([...links, { label: "访问网站", url: "" }])}>添加网站</Button>
    </section>
  );
}
