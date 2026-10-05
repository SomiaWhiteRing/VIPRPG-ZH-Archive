import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { BROWSER_INFO_ELEMENT, FORUM_ELEMENT_SOURCE_LENGTH } from "@/lib/forum-elements";
import { useState } from "react";
import { ForumModal } from "./shared";

export function ForumElementEditor({ source = "", onSave, onClose }: {
  source?: string;
  onSave: (source: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(source);
  return (
    <ForumModal open title={source ? "编辑浏览器元素" : "插入浏览器元素"} onKeyDown={(event) => event.stopPropagation()} onOpenChange={(open) => { if (!open) onClose(); }}>
      <div className="grid gap-3">
        <p className="text-sm text-muted">HTML、CSS 和 JavaScript 直接在帖子页面运行。可调用 window.viprpg.copyText(text) 复制文本，或 window.viprpg.copyBrowserInfo() 复制浏览器信息。</p>
        <Button type="button" variant="outline" className="w-fit" onClick={() => setValue(BROWSER_INFO_ELEMENT)}>填入“复制浏览器信息”示例</Button>
        <div>
          <Label htmlFor="forum-element-source">HTML / JavaScript</Label>
          <Textarea id="forum-element-source" autoFocus value={value} maxLength={FORUM_ELEMENT_SOURCE_LENGTH} className="h-72 font-mono text-xs" spellCheck={false} onChange={(event) => setValue(event.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
          <Button type="button" disabled={!value.trim() || value.length > FORUM_ELEMENT_SOURCE_LENGTH} onClick={() => onSave(value)}>{source ? "保存元素" : "插入正文"}</Button>
        </div>
      </div>
    </ForumModal>
  );
}
