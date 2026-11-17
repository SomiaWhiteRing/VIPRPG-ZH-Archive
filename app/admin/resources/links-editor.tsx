import { useMessages } from "@/lib/i18n/react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import type { ResourceLink } from "@/lib/resources";

export function ResourceLinksEditor({ initial, disabled }: {
  initial: ResourceLink[];
  disabled: boolean;
}) {
  const t = useMessages();
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
    <section className="grid gap-3" aria-label={t("admin.resources.buttons")}>
      <h3 className="font-bold">{t("admin.resources.buttons")}</h3>
      <p className="text-sm text-muted">{t("admin.resources.buttonHelp")}</p>
      <input type="hidden" name="linksJson" value={JSON.stringify(links)} />
      {links.map((link, index) => (
        <div key={index} className="grid gap-3 rounded-md border border-border p-3">
          <Label className="grid gap-2">
            {t("admin.resources.buttonText")}
            <Input value={link.label} onChange={(e) => update(index, "label", e.target.value)} required disabled={disabled} />
          </Label>
          <Label className="grid gap-2">
            {t("admin.resources.buttonUrl")}
            <Input type="url" value={link.url} onChange={(e) => update(index, "url", e.target.value)} required maxLength={2048} disabled={disabled} />
          </Label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled || index === 0} onClick={() => move(index, -1)}>{t("admin.characterIndex.up")}</Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled || index === links.length - 1} onClick={() => move(index, 1)}>{t("admin.characterIndex.down")}</Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setLinks(links.filter((_, i) => i !== index))}>{t("core.action.remove")}</Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" className="justify-self-start" disabled={disabled}
        onClick={() => setLinks([...links, { label: t("admin.resources.visit"), url: "" }])}>{t("admin.resources.addWebsite")}</Button>
    </section>
  );
}
