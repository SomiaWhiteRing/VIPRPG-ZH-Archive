"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type SetStateAction,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { LanguageField } from "@/app/admin/works/language-field";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Pane } from "@/app/components/ui/pane";
import { Progress } from "@/app/components/ui/progress";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { SelectField } from "@/app/components/ui/select";
import { StatList } from "@/app/components/ui/stat-list";
import { Textarea } from "@/app/components/ui/textarea";
import { useUploadController } from "@/app/upload/upload-controller";
import type {
  BrowserUploadTaskSnapshot,
  MetadataBlobUpload,
  UploadRecoveryDraft,
  UploadSourceFile,
  UploadSourceKind,
} from "@/app/upload/upload-types";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import { normalizeArchivePath } from "@/lib/archive/file-policy";
import { formatBytes, formatDate } from "@/lib/format";
import { ENGINE_OPTIONS, isArchiveEngineFamily } from "@/lib/labels";

type EngineFamily = ArchiveCommitMetadata["game"]["engineFamily"];
type CharacterCredit = NonNullable<ArchiveCommitMetadata["characters"]>[number];
type CreatorCredit = ArchiveCommitMetadata["creators"][number];
type WorkStaffCredit = ArchiveCommitMetadata["workStaff"][number];
export type UploadAuthorCredit = {
  creator: CreatorCredit;
  staff: WorkStaffCredit;
};
type AssociationDefaults = {
  characters: CharacterCredit[];
  authors: UploadAuthorCredit[];
};
type FlatMetadata = {
  originalTitle: string;
  chineseTitle: string;
  aliasTitles: string;
  engineFamily: EngineFamily;
  description: string;
  tags: string;
  characters: string;
  creatorNames: string;
  creatorUrl: string;
  isOriginal: boolean;
  language: string;
  sourceName: string;
  sourceUrl: string;
  externalDownloadUrl: string;
  status: "published" | "hidden";
};

type CurrentUser = {
  id: number;
  permissionKeys: string[];
};

export type UploadInitialWork = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  aliases: string[];
  description: string | null;
  engineFamily: "rpg_maker_2000" | "rpg_maker_2003" | "rpg_maker_2003_maniac";
  language: string;
  isOriginal: boolean;
  status: "published" | "hidden";
  tags: string[];
  characterCredits: CharacterCredit[];
  authorCredits: UploadAuthorCredit[];
  previewBlobSha256s: string[];
};

type ImageSelections = { cover: File | null; browsingImages: File[] };
type PreparedImages = {
  hashes: { browsingImageBlobSha256s: string[] };
  blobs: MetadataBlobUpload[];
};

export function UploadClient({
  currentUser,
  initialWork = null,
}: {
  currentUser: CurrentUser;
  initialWork?: UploadInitialWork | null;
}) {
  const router = useRouter();
  const upload = useUploadController(currentUser.id);
  const canArchiveUpload = currentUser.permissionKeys.includes("import_job.create");
  const [mode, setMode] = useState<UploadSourceKind>("folder");
  const [form, setForm] = useState<FlatMetadata>(() => initialForm(initialWork, canArchiveUpload));
  const [associationDefaults, setAssociationDefaults] = useState<AssociationDefaults>(
    () => initialAssociations(initialWork),
  );
  const [imageSelections, setImageSelections] = useState<ImageSelections>({
    cover: null,
    browsingImages: [],
  });
  const [sourceSummary, setSourceSummary] = useState<{
    name: string;
    fileCount: number;
    sizeBytes: number;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const canUploadFiles =
    initialWork !== null ||
    sourceSummary !== null ||
    (canArchiveUpload && isArchiveEngineFamily(form.engineFamily));
  const engineOptions = ENGINE_OPTIONS
    .filter((option) => !initialWork || option.distribution === "archive")
    .map(({ value, label }) => ({ value, label }));
  const relevantDrafts = upload.drafts.filter(
    (draft) =>
      draft.targetWorkId === (initialWork?.id ?? null) &&
      draft.serverImportJobId !== upload.task?.serverImportJobId,
  );

  async function startFolder(rawFiles: UploadSourceFile[], suggestedName: string) {
    setSubmitError(null);
    try {
      const source = normalizeFolderSource(rawFiles, suggestedName);
      if (!source.files.some((item) => item.relativePath.toLowerCase() === "rpg_rt.lmt")) {
        throw new Error("所选文件夹根目录缺少 RPG_RT.lmt，请选择游戏根目录。");
      }
      startSource("folder", source.sourceName, source.files);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "无法读取所选文件夹。");
    }
  }

  function startSource(
    sourceKind: UploadSourceKind,
    sourceName: string,
    files: UploadSourceFile[],
  ) {
    const sizeBytes = files.reduce((sum, item) => sum + item.file.size, 0);
    setMode(sourceKind);
    setSourceSummary({ name: sourceName, fileCount: files.length, sizeBytes });
    setForm((current) => ({
      ...current,
      originalTitle: current.originalTitle.trim()
        ? current.originalTitle
        : sourceName.replace(/\.zip$/i, ""),
      sourceName: current.sourceName.trim() ? current.sourceName : sourceName,
    }));
    upload.startSource({
      sourceKind,
      sourceName,
      files,
      targetWorkId: initialWork?.id ?? null,
    });
  }

  async function onFolderDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (sourceSummary || upload.active) return;
    setPreparing(true);
    try {
      const dropped = await readDroppedFolder(event.dataTransfer);
      await startFolder(dropped.files, dropped.sourceName);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "无法读取拖入的文件夹。");
    } finally {
      setPreparing(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    if (!form.originalTitle.trim()) {
      setSubmitError("请填写作品原名。");
      return;
    }
    if (initialWork && !isArchiveEngineFamily(form.engineFamily)) {
      setSubmitError("已有归档作品只能选择 RPG Maker 2000/2003 系引擎。");
      return;
    }
    if (!canUploadFiles) {
      if (!imageSelections.cover) {
        setSubmitError("新建外链作品必须选择封面图。");
        return;
      }
      if (!form.externalDownloadUrl.trim()) {
        setSubmitError("请填写外部下载地址。");
        return;
      }
      setPreparing(true);
      try {
        const result = await submitExternalWork(form, imageSelections);
        router.push(`/games/${result.workId}`);
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "发布外链作品失败。");
      } finally {
        setPreparing(false);
      }
      return;
    }
    if (!initialWork && !imageSelections.cover) {
      setSubmitError("新建游戏必须选择封面图。");
      return;
    }
    if (!imageSelections.cover && imageSelections.browsingImages.length) {
      setSubmitError("选择浏览图时也需要选择封面图。");
      return;
    }
    setPreparing(true);
    try {
      const images = imageSelections.cover
        ? await prepareSelectedImages(imageSelections)
        : {
            hashes: {
              browsingImageBlobSha256s: initialWork?.previewBlobSha256s ?? [],
            },
            blobs: [],
          };
      upload.confirmMetadata(
        buildMetadata(form, images.hashes, initialWork?.id ?? null, associationDefaults),
        images.blobs,
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "作品资料确认失败。");
    } finally {
      setPreparing(false);
    }
  }

  async function restore(draft: UploadRecoveryDraft) {
    if (!(await upload.restoreDraft(draft))) return;
    if (draft.metadata) {
      setForm(formFromMetadata(draft.metadata));
      setAssociationDefaults(associationsFromMetadata(draft.metadata));
      setImageSelections({
        cover: draft.metadataBlobs[0]?.file ?? null,
        browsingImages: draft.metadataBlobs.slice(1).map((item) => item.file),
      });
    }
    setMode(draft.preparedSource.sourceKind);
    setSourceSummary({
      name: draft.preparedSource.sourceName,
      fileCount: draft.preparedSource.stats.sourceFileCount,
      sizeBytes: draft.preparedSource.stats.sourceSizeBytes,
    });
  }

  function restart() {
    upload.resetTask();
    setSourceSummary(null);
    setSubmitError(null);
  }

  return (
    <div className="grid gap-5">
      {relevantDrafts.length ? (
        <Pane heading="可继续的上传">
          <ul className="divide-y divide-border">
            {relevantDrafts.map((draft) => {
              const committing = upload.committingDraftIds.includes(draft.serverImportJobId);
              return (
                <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={draft.key}>
                  <div>
                    <strong>{draft.preparedSource.sourceName}</strong>
                    <p className="mt-1 text-sm text-muted">
                      {committing ? "正在提交，暂时不能继续编辑" : `文件已上传 · 更新于 ${formatDate(draft.updatedAt)}`}
                    </p>
                  </div>
                  {!committing ? (
                    <div className="flex gap-2">
                      <Button onClick={() => void restore(draft)} type="button">继续填写</Button>
                      <Button onClick={() => void upload.discardDraft(draft)} type="button" variant="outline">放弃</Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Pane>
      ) : null}
      {upload.controllerError ? <p className="border border-red-300 bg-red-50 p-3 text-sm text-red-900">{upload.controllerError}</p> : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <aside className="grid content-start gap-4">
          <Pane>
            <SectionHeading eyebrow="游戏来源" title={canUploadFiles ? "游戏文件" : "外部下载"} />
            {canUploadFiles ? (
              <>
                {!sourceSummary && !upload.active ? <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="源类型">
                  <Button onClick={() => setMode("folder")} type="button" variant={mode === "folder" ? "default" : "outline"}>文件夹</Button>
                  <Button onClick={() => setMode("zip")} type="button" variant={mode === "zip" ? "default" : "outline"}>本地 ZIP</Button>
                </div> : null}
                {sourceSummary ? (
                  <StatList columns={2} items={[
                    { label: "来源", value: sourceSummary.name },
                    { label: "文件", value: (upload.task?.stats.sourceFileCount || sourceSummary.fileCount).toLocaleString("zh-CN") },
                    { label: "大小", value: formatBytes(upload.task?.stats.sourceSizeBytes || sourceSummary.sizeBytes) },
                  ]} variant="tiles" />
                ) : mode === "folder" ? (
                  <div className="grid gap-3 border-2 border-dashed border-border p-6 text-center" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void onFolderDrop(event)}>
                    <strong>拖入游戏文件夹</strong>
                    <span className="text-sm text-muted">或选择包含 RPG_RT.lmt 的游戏根目录</span>
                    <FilePicker directory label="选择游戏目录" multiple onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      const sourceName = folderNameFromPicker(files);
                      void startFolder(files.map((file) => ({ file, relativePath: webkitPath(file) })), sourceName);
                    }} />
                  </div>
                ) : (
                  <FilePicker accept=".zip,application/zip" label="选择本地 ZIP" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) startSource("zip", file.name, [{ file, relativePath: file.name }]);
                  }} />
                )}
              </>
            ) : <p className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">非 RPG Maker 2000/2003 系作品使用外部下载地址。</p>}
          </Pane>
          {upload.task ? <UploadProgress task={upload.task} onCancel={() => void upload.cancelTask()} onRestart={restart} /> : null}
        </aside>

        {upload.metadataConfirmed ? (
          <Pane heading="作品资料已确认">
            <p>{form.chineseTitle.trim() || form.originalTitle.trim()}</p>
            {!sourceSummary ? <p className="text-sm text-muted">现在选择游戏文件；文件准备完成后会自动提交。</p> : null}
            {!upload.task?.commitStarted ? <Button onClick={upload.revokeMetadata} type="button" variant="outline">修改资料</Button> : <p className="text-sm text-muted">正在提交，资料已锁定。</p>}
          </Pane>
        ) : (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <Pane heading="作品资料">
              <div className="grid gap-4 md:grid-cols-2">
                <TextField form={form} label="原名 *" name="originalTitle" setForm={setForm} required />
                <FormField label="游戏引擎 *"><SelectField onValueChange={(value) => setForm((current) => ({ ...current, engineFamily: value as EngineFamily }))} options={engineOptions.map((option) => ({ ...option, disabled: (isArchiveEngineFamily(option.value) && !canArchiveUpload) || (!initialWork && sourceSummary !== null && !isArchiveEngineFamily(option.value)) }))} value={form.engineFamily} required /></FormField>
                <TextField form={form} label="中文名" name="chineseTitle" setForm={setForm} />
                <FormField label="游戏语言 *"><LanguageField onValueChange={(language) => setForm((current) => ({ ...current, language }))} value={form.language} /></FormField>
                {initialWork ? <FormField label="公开状态"><SelectField onValueChange={(value) => setForm((current) => ({ ...current, status: value as "published" | "hidden" }))} options={[{ value: "published", label: "已发布" }, { value: "hidden", label: "隐藏" }]} value={form.status} /></FormField> : null}
                <FormField label="作品属性"><Label className="flex min-h-10 items-center gap-2"><Checkbox checked={form.isOriginal} onCheckedChange={(checked) => setForm((current) => ({ ...current, isOriginal: checked === true }))} />本站原创</Label></FormField>
                <FormField label="简介" wide><Textarea onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={5} value={form.description} /></FormField>
              </div>
            </Pane>
            <Pane heading="图片与分类">
              <div className="grid gap-4 md:grid-cols-2">
                <ImageField label="封面图" onChange={(cover) => setImageSelections((current) => ({ ...current, cover }))} required={!initialWork} />
                <FormField label="浏览图"><FilePicker accept="image/*" label="选择浏览图" multiple onChange={(event) => setImageSelections((current) => ({ ...current, browsingImages: Array.from(event.target.files ?? []) }))} /></FormField>
                <TextAreaField form={form} label="别名" name="aliasTitles" setForm={setForm} />
                <TextField form={form} label="标签" name="tags" setForm={setForm} />
                <TextAreaField form={form} label="登场角色" name="characters" setForm={setForm} />
                {initialWork ? <TextAreaField form={form} label="作者（每行一个）" name="creatorNames" setForm={setForm} /> : <div className="grid gap-4"><TextField form={form} label="作者名" name="creatorNames" setForm={setForm} /><TextField form={form} label="作者链接" name="creatorUrl" setForm={setForm} /></div>}
              </div>
            </Pane>
            <Pane heading={canUploadFiles ? "归档资料" : "外部下载"}>
              {canUploadFiles ? <div className="grid gap-4 md:grid-cols-2"><TextField form={form} label="来源名" name="sourceName" setForm={setForm} /><TextField form={form} label="来源链接" name="sourceUrl" setForm={setForm} /></div> : <FormField hint="该地址是作品的唯一下载入口。" label="外部下载地址 *"><Input onChange={(event) => setForm((current) => ({ ...current, externalDownloadUrl: event.target.value }))} required type="url" value={form.externalDownloadUrl} /></FormField>}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button disabled={preparing} type="submit">{preparing ? "正在确认…" : canUploadFiles ? "确认作品资料" : "发布外链作品"}</Button>
                {initialWork ? <Link className={buttonVariants({ variant: "outline" })} href={`/me/uploads/${initialWork.id}`}>只维护资料</Link> : null}
                {submitError ? <p className="text-sm text-red-700" role="alert">{submitError}</p> : null}
              </div>
            </Pane>
          </form>
        )}
      </div>
    </div>
  );
}

function UploadProgress({
  task,
  onCancel,
  onRestart,
}: {
  task: BrowserUploadTaskSnapshot;
  onCancel: () => void;
  onRestart: () => void;
}) {
  return <Pane heading="上传进度">
    <p className="text-sm text-muted">{phaseLabel(task.phase)}</p>
    <Progress aria-label="上传进度" value={Math.min(100, task.progress.percent)} />
    <p className="mt-2 font-mono text-xs text-muted">{Math.round(task.progress.percent)}%{task.progress.currentPath ? ` · ${task.progress.currentPath}` : ""}</p>
    {task.error ? <p className="border border-red-300 bg-red-50 p-3 text-sm text-red-900">{task.error}</p> : null}
    {task.result ? <p className="border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">上传完成。<Link className="font-semibold underline" href={`/games/${task.result.workId}`}>查看作品</Link></p> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {["running", "waiting"].includes(task.status) && task.phase !== "committing" ? <Button onClick={onCancel} type="button" variant="outline">取消上传</Button> : null}
      {["failed", "canceled"].includes(task.status) ? <Button onClick={onRestart} type="button">重新开始</Button> : null}
    </div>
  </Pane>;
}

function initialForm(work: UploadInitialWork | null, canArchiveUpload: boolean): FlatMetadata {
  return {
    originalTitle: work?.originalTitle ?? "",
    chineseTitle: work?.chineseTitle ?? "",
    aliasTitles: work?.aliases.join("\n") ?? "",
    engineFamily: work?.engineFamily ?? (canArchiveUpload ? "rpg_maker_2000" : "other"),
    description: work?.description ?? "",
    tags: work?.tags.join("\n") ?? "",
    characters: work?.characterCredits.map((character) => character.name).join("\n") ?? "",
    creatorNames: work?.authorCredits.map((author) => author.creator.name).join("\n") ?? "",
    creatorUrl: "",
    isOriginal: work?.isOriginal ?? false,
    language: work?.language ?? "zh-CN",
    sourceName: "",
    sourceUrl: "",
    externalDownloadUrl: "",
    status: work?.status ?? "published",
  };
}

function initialAssociations(work: UploadInitialWork | null): AssociationDefaults {
  return work
    ? { characters: work.characterCredits, authors: work.authorCredits }
    : { characters: [], authors: [] };
}

function associationsFromMetadata(metadata: ArchiveCommitMetadata): AssociationDefaults {
  const creators = new Map(
    metadata.creators.map((creator) => [entityNameKey(creator.name), creator]),
  );
  return {
    characters: metadata.characters ?? [],
    authors: metadata.workStaff
      .filter((staff) => staff.roleKey === "author")
      .map((staff) => ({
        creator: creators.get(entityNameKey(staff.creatorName)) ?? {
          name: staff.creatorName,
          originalName: null,
          websiteUrl: null,
          extra: {},
        },
        staff,
      })),
  };
}

function formFromMetadata(metadata: ArchiveCommitMetadata): FlatMetadata {
  const authorNames = metadata.workStaff
    .filter((staff) => staff.roleKey === "author")
    .map((staff) => staff.creatorName);
  const creator = metadata.creators.find(
    (item) => entityNameKey(item.name) === entityNameKey(authorNames[0] ?? ""),
  );
  return {
    originalTitle: metadata.game.originalTitle,
    chineseTitle: metadata.game.chineseTitle ?? "",
    aliasTitles: metadata.workTitles.map((item) => item.title).join("\n"),
    engineFamily: metadata.game.engineFamily,
    description: metadata.game.description ?? "",
    tags: metadata.tags.join("\n"),
    characters: (metadata.characters ?? []).map((item) => item.name).join("\n"),
    creatorNames: authorNames.join("\n"),
    creatorUrl: creator?.websiteUrl ?? "",
    isOriginal: metadata.game.isOriginal,
    language: metadata.game.language,
    sourceName: metadata.archiveVersion.sourceName ?? "",
    sourceUrl: metadata.archiveVersion.sourceUrl ?? "",
    externalDownloadUrl: "",
    status: metadata.game.status === "hidden" ? "hidden" : "published",
  };
}

function buildMetadata(
  form: FlatMetadata,
  imageHashes: { browsingImageBlobSha256s: string[] },
  targetWorkId: number | null,
  defaults: AssociationDefaults,
): ArchiveCommitMetadata {
  const characterDefaults = new Map(
    defaults.characters.map((character) => [entityNameKey(character.name), character]),
  );
  const characters = parseList(form.characters).map((name, index) => {
    const existing = characterDefaults.get(entityNameKey(name));
    return {
      name,
      originalName: existing?.originalName ?? null,
      roleKey: existing?.roleKey ?? "supporting",
      spoilerLevel: existing?.spoilerLevel ?? 0,
      sortOrder: index + 1,
      notes: existing?.notes ?? null,
    } satisfies CharacterCredit;
  });
  const authorDefaults = new Map(
    defaults.authors.map((author) => [entityNameKey(author.creator.name), author]),
  );
  const authorNames = parseList(form.creatorNames);
  const creators = authorNames.map((name, index) => {
    const existing = authorDefaults.get(entityNameKey(name));
    return {
      name,
      originalName: existing?.creator.originalName ?? null,
      websiteUrl: existing?.creator.websiteUrl ?? (!targetWorkId && index === 0 ? cleanNullable(form.creatorUrl) : null),
      extra: existing?.creator.extra ?? {},
    } satisfies CreatorCredit;
  });
  const workStaff = authorNames.map((creatorName) => {
    const existing = authorDefaults.get(entityNameKey(creatorName));
    return {
      creatorName,
      roleKey: "author",
      roleLabel: existing?.staff.roleLabel ?? "作者",
      notes: existing?.staff.notes ?? null,
    } satisfies WorkStaffCredit;
  });
  return {
    game: {
      originalTitle: form.originalTitle.trim(),
      chineseTitle: cleanNullable(form.chineseTitle),
      description: cleanNullable(form.description),
      originalReleaseDate: null,
      originalReleasePrecision: "unknown",
      engineFamily: form.engineFamily,
      isOriginal: form.isOriginal,
      language: form.language,
      browsingImageBlobSha256s: imageHashes.browsingImageBlobSha256s,
      status: form.status,
      extra: {},
    },
    target: { mode: targetWorkId ? "update" : "create", workId: targetWorkId },
    archiveVersion: { sourceName: cleanNullable(form.sourceName), sourceUrl: cleanNullable(form.sourceUrl) },
    workTitles: parseList(form.aliasTitles).map((title) => ({ title, language: null, titleType: "alias" })),
    characters,
    creators,
    workStaff,
    tags: parseList(form.tags),
    externalLinks: { work: [] },
  };
}

async function prepareSelectedImages(input: ImageSelections): Promise<PreparedImages> {
  const blobs: MetadataBlobUpload[] = [];
  const hashes: string[] = [];
  if (input.cover) hashes.push(await prepareMetadataImage(input.cover, blobs));
  for (const file of input.browsingImages) hashes.push(await prepareMetadataImage(file, blobs));
  return { hashes: { browsingImageBlobSha256s: hashes }, blobs: [...new Map(blobs.map((blob) => [blob.sha256, blob])).values()] };
}

async function prepareMetadataImage(file: File, blobs: MetadataBlobUpload[]): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} 不是图片文件。`);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  blobs.push({ sha256, file, contentType: file.type });
  return sha256;
}

async function submitExternalWork(form: FlatMetadata, images: ImageSelections): Promise<{ workId: number }> {
  if (!images.cover) throw new Error("外链作品必须提供封面图。");
  const body = new FormData();
  body.set("original_title", form.originalTitle.trim());
  body.set("chinese_title", form.chineseTitle.trim());
  body.set("description", form.description.trim());
  body.set("engine_family", form.engineFamily);
  if (form.isOriginal) body.set("is_original", "1");
  body.set("language", form.language);
  body.set("aliases", form.aliasTitles);
  body.set("tags", form.tags);
  body.set("characters", form.characters);
  body.set("creator_name", parseList(form.creatorNames)[0] ?? "");
  body.set("creator_url", form.creatorUrl.trim());
  body.set("download_url", form.externalDownloadUrl.trim());
  body.set("cover", images.cover);
  for (const image of images.browsingImages) body.append("browsing_images[]", image);
  const response = await fetch("/api/works/external", { method: "POST", body, credentials: "same-origin" });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; workId?: number; detail?: string; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.workId) throw new Error(payload?.detail || payload?.error || "发布外链作品失败。");
  return { workId: payload.workId };
}

function TextField({ form, name, label, setForm, required = false }: { form: FlatMetadata; name: keyof FlatMetadata; label: string; setForm: Dispatch<SetStateAction<FlatMetadata>>; required?: boolean }) {
  return <FormField label={label}><Input onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} required={required} type="text" value={String(form[name])} /></FormField>;
}
function TextAreaField({ form, name, label, setForm }: { form: FlatMetadata; name: keyof FlatMetadata; label: string; setForm: Dispatch<SetStateAction<FlatMetadata>> }) {
  return <FormField label={label}><Textarea onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} rows={4} value={String(form[name])} /></FormField>;
}
function ImageField({ label, required, onChange }: { label: string; required: boolean; onChange: (file: File | null) => void }) {
  return <FormField label={label}><FilePicker accept="image/*" label={`选择${label}`} onChange={(event) => onChange(event.target.files?.[0] ?? null)} required={required} /></FormField>;
}
function FilePicker({ accept, directory = false, label, multiple = false, onChange, required = false }: { accept?: string; directory?: boolean; label: string; multiple?: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void; required?: boolean }) {
  const id = `file-picker-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return <div className="grid gap-2"><Button asChild variant="outline"><Label className="cursor-pointer" htmlFor={id}>{label}</Label></Button><input accept={accept} className="sr-only" id={id} multiple={multiple} onChange={onChange} required={required} type="file" {...(directory ? { webkitdirectory: "", directory: "" } : {})} /></div>;
}

function normalizeFolderSource(rawFiles: UploadSourceFile[], suggestedName: string) {
  if (!rawFiles.length) throw new Error("文件夹中没有可读取的文件。");
  const normalized = rawFiles.map((item) => ({ ...item, relativePath: normalizeArchivePath(item.relativePath) }));
  const firstParts = normalized[0].relativePath.split("/");
  const commonRoot = firstParts.length > 1 ? firstParts[0] : null;
  const strip = commonRoot && normalized.every((item) => item.relativePath.startsWith(`${commonRoot}/`));
  const files = normalized.map((item) => ({ ...item, relativePath: strip ? item.relativePath.split("/").slice(1).join("/") : item.relativePath }));
  return { sourceName: suggestedName || commonRoot || "local-folder", files };
}

async function readDroppedFolder(dataTransfer: DataTransfer): Promise<{ sourceName: string; files: UploadSourceFile[] }> {
  const entries = Array.from(dataTransfer.items)
    .map((item): DroppedEntry | null => {
      const getEntry = (item as unknown as { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry;
      return getEntry?.call(item) ?? null;
    })
    .filter((entry): entry is DroppedEntry => entry !== null);
  if (entries.length === 1 && entries[0].isDirectory) {
    const files = await readDroppedEntry(entries[0], entries[0].name);
    return { sourceName: entries[0].name, files };
  }
  const files = Array.from(dataTransfer.files).map((file) => ({ file, relativePath: webkitPath(file) }));
  return { sourceName: folderNameFromPicker(Array.from(dataTransfer.files)), files };
}

async function readDroppedEntry(entry: DroppedEntry, path: string): Promise<UploadSourceFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as DroppedFileEntry).file(resolve, reject));
    return [{ file, relativePath: path }];
  }
  const reader = (entry as DroppedDirectoryEntry).createReader();
  const children: DroppedEntry[] = [];
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((child) => readDroppedEntry(child, `${path}/${child.name}`)));
  return nested.flat();
}

type DroppedEntry = { isFile: boolean; isDirectory: boolean; name: string };
type DroppedFileEntry = DroppedEntry & { file: (resolve: (file: File) => void, reject: (error: DOMException) => void) => void };
type DroppedDirectoryEntry = DroppedEntry & { createReader: () => { readEntries: (resolve: (entries: DroppedEntry[]) => void, reject: (error: DOMException) => void) => void } };

function webkitPath(file: File): string { return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name; }
function folderNameFromPicker(files: File[]): string { const first = files[0] ? webkitPath(files[0]).split("/")[0] : "local-folder"; return first || "local-folder"; }
function entityNameKey(value: string): string { return value.toLowerCase(); }
function cleanNullable(value: string): string | null { return value.trim() || null; }
function parseList(value: string): string[] { return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))]; }
function phaseLabel(phase: string): string {
  const labels: Record<string, string> = { enumerating: "读取文件", hashing: "校验文件", building_core_pack: "整理公共文件", creating_import_job: "创建上传任务", preflighting: "检查已有对象", uploading_source: "上传游戏文件", verifying_source: "确认游戏文件", awaiting_metadata: "等待作品资料", uploading_metadata: "上传资料图片", committing: "提交入库", completed: "完成" };
  return labels[phase] ?? "准备";
}
