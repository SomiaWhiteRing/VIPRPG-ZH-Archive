"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { CheckboxField } from "@/app/components/ui/checkbox-field";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Pane } from "@/app/components/ui/pane";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { LanguageField } from "@/app/admin/works/language-field";
import { ENGINE_OPTIONS } from "@/lib/labels";
import Link from "next/link";

type EditableWork = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  engineFamily: string;
  isOriginal: boolean;
  language: string;
  status: "published" | "hidden";
  aliases: string[];
  tags: string[];
  characters: string[];
  authors: string[];
  distribution: "archive" | "external";
  externalDownloadUrl: string | null;
};

export function WorkEditClient({ work }: { work: EditableWork }) {
  const router = useRouter();
  const [language, setLanguage] = useState(work.language);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/works/${work.id}/owned`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; detail?: string; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload && "detail" in payload
            ? payload.detail || payload.error || "保存失败。"
            : "保存失败。",
        );
      }
      setMessage("作品资料已保存。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Pane heading="作品资料">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="原名 *"><Input defaultValue={work.originalTitle} name="original_title" required /></FormField>
          <FormField label="中文名"><Input defaultValue={work.chineseTitle ?? ""} name="chinese_title" /></FormField>
          <FormField label="引擎 *"><SelectField defaultValue={work.engineFamily} name="engine_family" options={ENGINE_OPTIONS.filter((option) => option.distribution === work.distribution).map(({ value, label }) => ({ value, label }))} required /></FormField>
          <FormField label="游戏语言 *"><LanguageField name="language" onValueChange={setLanguage} value={language} /></FormField>
          <FormField label="公开状态"><SelectField defaultValue={work.status} name="status" options={[{ value: "published", label: "已发布" }, { value: "hidden", label: "隐藏" }]} /></FormField>
          <FormField label="作品属性"><CheckboxField defaultChecked={work.isOriginal} label="本站原创" name="is_original" /></FormField>
          <FormField label="简介" wide><Textarea defaultValue={work.description ?? ""} name="description" rows={6} /></FormField>
        </div>
      </Pane>
      <Pane heading="作者与分类">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField hint="每行一个" label="别名"><Textarea defaultValue={work.aliases.join("\n")} name="aliases" rows={5} /></FormField>
          <FormField hint="逗号或换行分隔" label="标签"><Textarea defaultValue={work.tags.join("\n")} name="tags" rows={5} /></FormField>
          <FormField hint="逗号或换行分隔" label="登场角色"><Textarea defaultValue={work.characters.join("\n")} name="characters" rows={5} /></FormField>
          <FormField hint="每行一个；作者主页资料由作者管理功能维护" label="作者">
            <Textarea defaultValue={work.authors.join("\n")} name="authors" rows={5} />
          </FormField>
        </div>
      </Pane>
      <Pane heading="下载与图片">
        <div className="grid gap-4 md:grid-cols-2">
          {work.distribution === "external" ? <FormField label="外部下载地址 *"><Input defaultValue={work.externalDownloadUrl ?? ""} name="download_url" required type="url" /></FormField> : null}
          <FormField hint="选择后将整体替换现有封面和浏览图；第一张作为封面。" label="替换作品图片">
            <Input accept="image/*" multiple name="images[]" type="file" />
          </FormField>
        </div>
      </Pane>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button disabled={busy} type="submit">{busy ? "正在保存…" : "保存作品资料"}</Button>
        {work.distribution === "archive" ? <Link className={buttonVariants({ variant: "outline" })} href={`/upload/${work.id}`}>上传新版本</Link> : null}
        {message ? <p aria-live="polite" className={message.includes("已保存") ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{message}</p> : null}
      </div>
    </form>
  );
}
