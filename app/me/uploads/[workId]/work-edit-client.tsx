"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Link as LinkIcon } from "lucide-react";
import { LanguageField } from "@/app/admin/works/language-field";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { EnginePicker } from "@/app/upload/engine-picker";
import { CoverPicker, PreviewPicker } from "@/app/upload/media-picker";
import { TokenPicker } from "@/app/upload/token-picker";
import type { UploadTaxonomySuggestion } from "@/app/upload/upload-types";
import { WorkbenchField } from "@/app/upload/workbench-field";
import { isArchiveEngineFamily } from "@/lib/labels";

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
  previewBlobSha256s: string[];
};

export function WorkEditClient({
  suggestions,
  work,
}: {
  suggestions: {
    tags: UploadTaxonomySuggestion[];
    characters: UploadTaxonomySuggestion[];
  };
  work: EditableWork;
}) {
  const router = useRouter();
  const [engineFamily, setEngineFamily] = useState(work.engineFamily);
  const [language, setLanguage] = useState(work.language);
  const [tags, setTags] = useState(work.tags);
  const [characters, setCharacters] = useState(work.characters);
  const [isOriginal, setIsOriginal] = useState(work.isOriginal);
  const [externalDownloadUrl, setExternalDownloadUrl] = useState(
    work.externalDownloadUrl ?? "",
  );
  const [cover, setCover] = useState<File | null>(null);
  const [previewImages, setPreviewImages] = useState<File[]>([]);
  const [mediaRevision, setMediaRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const archiveMode = isArchiveEngineFamily(engineFamily);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (previewImages.length && !cover) {
      setMessage("添加预览图时须同时更新封面图。");
      return;
    }
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const coverEntry = form.get("cover_image");
    const previewEntries = form
      .getAll("preview_images[]")
      .filter((value): value is File => value instanceof File && value.size > 0);
    form.delete("cover_image");
    form.delete("preview_images[]");
    if (coverEntry instanceof File && coverEntry.size > 0) {
      form.append("images[]", coverEntry);
      for (const preview of previewEntries) form.append("images[]", preview);
    }
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
      setCover(null);
      setPreviewImages([]);
      setMediaRevision((current) => current + 1);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset className="contents" disabled={busy}>
        <section className="overflow-visible rounded-lg border border-border bg-card shadow-sm">
          <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-start sm:gap-x-3">
            <span className="text-sm font-bold sm:pt-2">游戏引擎</span>
            <EnginePicker
              disabled={busy}
              disabledReason={(option) => {
                if (option.distribution === work.distribution) return null;
                return work.distribution === "archive"
                  ? "已有游戏文件，不能切换到外链类型"
                  : "存在外部下载链接，不能切换到保存库类型";
              }}
              onValueChange={setEngineFamily}
              value={engineFamily}
            />
            <input name="engine_family" type="hidden" value={engineFamily} />
          </div>

          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 divide-y divide-border">
              {!archiveMode ? (
                <section className="p-4 sm:p-5">
                  <header className="mb-4">
                    <h2 className="m-0 text-lg font-bold">外部下载</h2>
                    <p className="mt-1 text-sm text-muted">
                      保存库暂不支持RM2k系以外作品，您可以提交外部网盘链接。
                    </p>
                  </header>
                  <div className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-2.5">
                    <LinkIcon className="size-5 text-muted" />
                    <Input
                      aria-label="外部下载地址"
                      name="download_url"
                      onChange={(event) => setExternalDownloadUrl(event.target.value)}
                      required
                      type="url"
                      value={externalDownloadUrl}
                    />
                  </div>
                </section>
              ) : null}

              <section className="p-4 sm:p-5">
                <h2 className="mb-4 text-lg font-bold">作品资料</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <WorkbenchField controlId="edit-chinese-title" label="中文名">
                    <Input
                      defaultValue={work.chineseTitle ?? ""}
                      id="edit-chinese-title"
                      name="chinese_title"
                    />
                  </WorkbenchField>
                  <WorkbenchField controlId="edit-original-title" label="原名" required>
                    <Input
                      defaultValue={work.originalTitle}
                      id="edit-original-title"
                      name="original_title"
                      required
                    />
                  </WorkbenchField>
                  <WorkbenchField className="md:col-span-2" controlId="edit-authors" label="作者">
                    <div className="grid gap-2">
                      <Input
                        defaultValue={work.authors.join(", ")}
                        id="edit-authors"
                        name="authors"
                      />
                      {isOriginal ? <input name="is_original" type="hidden" value="1" /> : null}
                      <Label className="flex w-fit items-center gap-2 text-xs font-semibold text-red-700">
                        <Checkbox
                          checked={isOriginal}
                          className="data-[state=checked]:border-red-700 data-[state=checked]:bg-red-700"
                          onCheckedChange={(checked) => setIsOriginal(checked === true)}
                        />
                        本作品为我原创。
                      </Label>
                    </div>
                  </WorkbenchField>
                  <WorkbenchField className="md:col-span-2" controlId="edit-description" label="简介">
                    <Textarea
                      defaultValue={work.description ?? ""}
                      id="edit-description"
                      name="description"
                      rows={4}
                    />
                  </WorkbenchField>
                  <WorkbenchField className="md:col-span-2" controlId="edit-tags" label="标签">
                    <TokenPicker
                      id="edit-tags"
                      name="tags"
                      onChange={setTags}
                      placeholder="搜索或创建标签"
                      recommendationLabel="推荐标签"
                      suggestions={suggestions.tags}
                      values={tags}
                    />
                  </WorkbenchField>
                  <WorkbenchField className="md:col-span-2" controlId="edit-characters" label="登场角色">
                    <TokenPicker
                      id="edit-characters"
                      name="characters"
                      onChange={setCharacters}
                      placeholder="搜索或添加角色"
                      recommendationLabel="常用角色"
                      suggestions={suggestions.characters}
                      values={characters}
                    />
                  </WorkbenchField>
                  <details className="md:col-span-2">
                    <summary className="cursor-pointer py-1 text-sm font-bold">更多设置</summary>
                    <div className="mt-3 grid gap-4 border-t border-border pt-4 md:grid-cols-2">
                      <WorkbenchField className="md:col-span-2" label="预览图">
                        <PreviewPicker
                          existingCount={Math.max(0, work.previewBlobSha256s.length - 1)}
                          files={previewImages}
                          key={`previews-${mediaRevision}`}
                          name="preview_images[]"
                          onChange={setPreviewImages}
                        />
                      </WorkbenchField>
                      <WorkbenchField controlId="edit-aliases" label="别名">
                        <Textarea
                          defaultValue={work.aliases.join("\n")}
                          id="edit-aliases"
                          name="aliases"
                          rows={3}
                        />
                      </WorkbenchField>
                    </div>
                  </details>
                </div>
              </section>
            </div>

            <aside className="min-w-0 border-t border-border bg-background/40 lg:border-l lg:border-t-0">
              <div className="lg:sticky lg:top-16">
                <div className="border-b border-border p-4">
                  <CoverPicker
                    existingBlobSha256={work.previewBlobSha256s[0]}
                    file={cover}
                    key={`cover-${mediaRevision}`}
                    name="cover_image"
                    onChange={setCover}
                    required={!work.previewBlobSha256s.length}
                  />
                  <p className="mt-2 text-xs text-muted">
                    不选择则保留现有封面；添加预览图时须同时更新封面。
                  </p>
                </div>
                <div className="grid gap-4 border-b border-border p-4">
                  <div className="grid gap-2">
                    <span className="text-sm font-bold">游戏语言 <span className="text-accent">*</span></span>
                    <LanguageField name="language" onValueChange={setLanguage} value={language} />
                  </div>
                  <div className="grid gap-2">
                    <Label className="font-bold">公开状态</Label>
                    <SelectField
                      defaultValue={work.status}
                      name="status"
                      options={[
                        { value: "published", label: "已发布" },
                        { value: "hidden", label: "隐藏" },
                      ]}
                    />
                  </div>
                </div>
                <div className="grid gap-3 p-4">
                  {message ? (
                    <p
                      aria-live="polite"
                      className={message.includes("已保存")
                        ? "border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
                        : "border border-red-300 bg-red-50 p-3 text-sm text-red-900"}
                    >
                      {message}
                    </p>
                  ) : null}
                  <Button className="min-h-12 w-full" disabled={busy} type="submit" variant="rm2k">
                    {busy ? "正在保存…" : "保存作品资料"}
                  </Button>
                  {work.distribution === "archive" ? (
                    <Link
                      className={buttonVariants({ className: "w-full", variant: "outline" })}
                      href={`/upload/${work.id}`}
                    >
                      编辑游戏文件
                    </Link>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </fieldset>
    </form>
  );
}
