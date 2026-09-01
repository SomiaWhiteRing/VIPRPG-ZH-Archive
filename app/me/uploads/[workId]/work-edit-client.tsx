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
import { CharacterPicker } from "@/app/upload/character-picker";
import { CoverPicker, PreviewPicker } from "@/app/upload/media-picker";
import { TokenPicker } from "@/app/upload/token-picker";
import type { UploadTaxonomySuggestion } from "@/app/upload/upload-types";
import { WorkbenchField } from "@/app/upload/workbench-field";
import { updateTranslationPreference } from "@/app/upload/translation-preference";
import { isArchiveEngineFamily } from "@/lib/labels";
import type {
  CharacterCreditSelection,
  CharacterSuggestion,
} from "@/lib/character-names";
import {
  ORIGINAL_RELEASE_DATE_FORMAT_ERROR,
  parseOriginalReleaseDate,
} from "@/lib/original-release-date";

type EditableWork = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  status: "published" | "hidden";
  aliases: string[];
  tags: string[];
  characters: CharacterCreditSelection[];
  authors: string[];
  translators: string[];
  distribution: "archive" | "external";
  externalDownloadUrl: string | null;
  sourceUrl: string | null;
  previewBlobSha256s: string[];
};

export function WorkEditClient({
  currentUserId,
  suggestions,
  work,
}: {
  currentUserId: number;
  suggestions: {
    tags: UploadTaxonomySuggestion[];
    characters: CharacterSuggestion[];
  };
  work: EditableWork;
}) {
  const router = useRouter();
  const [engineFamily, setEngineFamily] = useState(work.engineFamily);
  const [language, setLanguage] = useState(work.language);
  const [tags, setTags] = useState(work.tags);
  const [characters, setCharacters] = useState(work.characters);
  const [isOriginal, setIsOriginal] = useState(work.isOriginal);
  const [isTranslation, setIsTranslation] = useState(work.isTranslation);
  const [translatorName, setTranslatorName] = useState(work.translators[0] ?? "");
  const [translatorError, setTranslatorError] = useState<string | null>(null);
  const [externalDownloadUrl, setExternalDownloadUrl] = useState(
    work.externalDownloadUrl ?? "",
  );
  const [cover, setCover] = useState<File | null>(null);
  const [previewImages, setPreviewImages] = useState<File[]>([]);
  const [mediaRevision, setMediaRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const archiveMode = isArchiveEngineFamily(engineFamily);

  function changeOriginalDeclaration(checked: boolean) {
    setTranslatorError(null);
    setIsOriginal(checked);
    if (checked) {
      setIsTranslation(false);
      updateTranslationPreference(currentUserId, { isTranslation: false });
    }
  }

  function changeTranslationDeclaration(checked: boolean) {
    setTranslatorError(null);
    setIsTranslation(checked);
    if (checked) setIsOriginal(false);
    updateTranslationPreference(currentUserId, { isTranslation: checked });
  }

  function changeTranslatorName(value: string) {
    setTranslatorError(null);
    setTranslatorName(value);
    updateTranslationPreference(currentUserId, {
      isTranslation,
      translatorText: value.trim() || null,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    setTranslatorError(null);
    if (isOriginal && isTranslation) {
      setMessage("原创声明与翻译声明不能同时选择。");
      return;
    }
    if (isTranslation && !translatorName.trim()) {
      setTranslatorError("请填写译者。");
      document.getElementById("edit-translator")?.focus();
      return;
    }
    if (!parseOriginalReleaseDate(String(form.get("original_release_date") ?? ""))) {
      setMessage(ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
      document.getElementById("edit-release-date")?.focus();
      return;
    }
    if (previewImages.length && !cover) {
      setMessage("添加预览图时须同时更新封面图。");
      return;
    }
    setBusy(true);
    form.delete("cover_image");
    form.delete("preview_images[]");
    if (cover) {
      form.append("images[]", cover);
      for (const preview of previewImages) form.append("images[]", preview);
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
                  <WorkbenchField controlId="edit-author" label="作者">
                    <Input
                      defaultValue={work.authors[0] ?? ""}
                      id="edit-author"
                      name="author"
                    />
                  </WorkbenchField>
                  {isTranslation ? (
                    <WorkbenchField controlId="edit-translator" label="译者" required>
                      <div className="grid gap-1.5">
                        <Input
                          aria-describedby={translatorError ? "edit-translator-error" : undefined}
                          aria-invalid={translatorError ? true : undefined}
                          id="edit-translator"
                          name="translator"
                          onChange={(event) => changeTranslatorName(event.target.value)}
                          required
                          value={translatorName}
                        />
                        {translatorError ? (
                          <p className="text-sm text-red-700" id="edit-translator-error" role="alert">
                            {translatorError}
                          </p>
                        ) : null}
                      </div>
                    </WorkbenchField>
                  ) : null}
                  <WorkbenchField
                    className="md:col-span-2"
                    controlId="edit-release-date"
                    info="作品最初发表的日期"
                    label="发布日期"
                  >
                    <Input
                      defaultValue={work.originalReleaseDate ?? ""}
                      id="edit-release-date"
                      name="original_release_date"
                    />
                  </WorkbenchField>
                  <WorkbenchField
                    className="md:col-span-2"
                    label={<span id="edit-declarations-label">发布声明</span>}
                  >
                    <div
                      aria-labelledby="edit-declarations-label"
                      className="flex flex-wrap gap-x-5 gap-y-3 py-2.5"
                      role="group"
                    >
                      {isOriginal ? <input name="is_original" type="hidden" value="1" /> : null}
                      {isTranslation ? <input name="is_translation" type="hidden" value="1" /> : null}
                      <Label className="flex w-fit items-center gap-2 text-sm text-red-700" htmlFor="edit-is-original">
                        <Checkbox
                          checked={isOriginal}
                          className="data-[state=checked]:border-red-700 data-[state=checked]:bg-red-700"
                          id="edit-is-original"
                          onCheckedChange={(checked) => changeOriginalDeclaration(checked === true)}
                        />
                        本作品为我原创。
                      </Label>
                      <Label className="flex w-fit items-center gap-2 text-sm" htmlFor="edit-is-translation">
                        <Checkbox
                          checked={isTranslation}
                          id="edit-is-translation"
                          onCheckedChange={(checked) => changeTranslationDeclaration(checked === true)}
                        />
                        本作品为翻译作品。
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
                    <CharacterPicker
                      id="edit-characters"
                      name="characters"
                      onChange={setCharacters}
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
                      {work.distribution === "external" ? (
                        <WorkbenchField controlId="edit-source-url" label="来源链接">
                          <Input
                            defaultValue={work.sourceUrl ?? ""}
                            id="edit-source-url"
                            name="source_url"
                            type="url"
                          />
                        </WorkbenchField>
                      ) : null}
                    </div>
                  </details>
                </div>
              </section>
            </div>

            <aside className="min-w-0 border-t border-border bg-background/40 lg:border-l lg:border-t-0">
              <div className="lg:sticky lg:top-16">
                <div className="border-b border-border p-4">
                  <CoverPicker
                    candidateFiles={previewImages}
                    existingBlobSha256s={work.previewBlobSha256s}
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
