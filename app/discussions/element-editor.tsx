import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { browserInfoElement, FORUM_ELEMENT_SOURCE_LENGTH } from "@/lib/forum-elements";
import { useState } from "react";
import { ForumModal } from "./shared";

export function ForumElementEditor({ source = "", onSave, onClose }: {
  source?: string;
  onSave: (source: string) => void;
  onClose: () => void;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const [value, setValue] = useState(source);
  return (
    <ForumModal open title={source ? t("forum.element.edit") : t("forum.editor.insertElement")} onKeyDown={(event) => event.stopPropagation()} onOpenChange={(open) => { if (!open) onClose(); }}>
      <div className="grid gap-3">
        <p className="text-sm text-muted">{t("forum.element.hint")}</p>
        <Button type="button" variant="outline" className="w-fit" onClick={() => setValue(browserInfoElement(locale))}>{t("forum.element.example")}</Button>
        <div>
          <Label htmlFor="forum-element-source">HTML / JavaScript</Label>
          <Textarea id="forum-element-source" autoFocus value={value} maxLength={FORUM_ELEMENT_SOURCE_LENGTH} className="h-72 font-mono text-xs" spellCheck={false} onChange={(event) => setValue(event.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("relation.edit.cancel")}</Button>
          <Button type="button" disabled={!value.trim() || value.length > FORUM_ELEMENT_SOURCE_LENGTH} onClick={() => onSave(value)}>{source ? t("forum.element.save") : t("forum.element.insertBody")}</Button>
        </div>
      </div>
    </ForumModal>
  );
}
