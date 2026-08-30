"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type SetStateAction,
  useId,
  useState,
} from "react";
import {
  Check,
  FileArchive,
  FolderOpen,
  Link as LinkIcon,
  Upload,
} from "lucide-react";
import { LanguageField } from "@/app/admin/works/language-field";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Progress } from "@/app/components/ui/progress";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { EnginePicker } from "@/app/upload/engine-picker";
import { CoverPicker, PreviewPicker } from "@/app/upload/media-picker";
import { TokenPicker } from "@/app/upload/token-picker";
import { useUploadController } from "@/app/upload/upload-controller";
import type {
  BrowserUploadTaskSnapshot,
  MetadataBlobUpload,
  UploadRecoveryDraft,
  UploadSourceFile,
  UploadSourceKind,
  UploadTaxonomySuggestion,
} from "@/app/upload/upload-types";
import { WorkbenchField } from "@/app/upload/workbench-field";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import { normalizeArchivePath } from "@/lib/archive/file-policy";
import { formatBytes, formatDate } from "@/lib/format";
import { isArchiveEngineFamily } from "@/lib/labels";
import { cn } from "@/lib/ui/cn";

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
  tags: string[];
  characters: string[];
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
  suggestions,
}: {
  currentUser: CurrentUser;
  initialWork?: UploadInitialWork | null;
  suggestions: {
    tags: UploadTaxonomySuggestion[];
    characters: UploadTaxonomySuggestion[];
  };
}) {
  const router = useRouter();
  const upload = useUploadController(currentUser.id);
  const canArchiveUpload = currentUser.permissionKeys.includes("import_job.create");
  const [mode, setMode] = useState<UploadSourceKind>("folder");
  const [form, setForm] = useState<FlatMetadata>(() =>
    initialForm(initialWork, canArchiveUpload),
  );
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
  const archiveMode = isArchiveEngineFamily(form.engineFamily);
  const metadataLocked = upload.metadataConfirmed || Boolean(upload.task?.commitStarted);
  const formDisabled = preparing || metadataLocked;
  const gameFileLocksType = Boolean(
    initialWork || sourceSummary || upload.active || upload.task?.sourceReady,
  );
  const externalLinkLocksType = Boolean(form.externalDownloadUrl.trim());
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

  async function onSourceDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (preparing || sourceSummary || upload.active) return;
    setPreparing(true);
    try {
      const firstItem = event.dataTransfer.items[0];
      const getEntry = firstItem
        ? (firstItem as DataTransferItem & {
            webkitGetAsEntry?: () => DroppedEntry | null;
          }).webkitGetAsEntry
        : undefined;
      const entry = getEntry?.call(firstItem) ?? null;
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 1 && !entry?.isDirectory && /\.zip$/i.test(files[0].name)) {
        startSource("zip", files[0].name, [{ file: files[0], relativePath: files[0].name }]);
      } else {
        const dropped = await readDroppedFolder(event.dataTransfer);
        await startFolder(dropped.files, dropped.sourceName);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "无法读取拖入的游戏文件。");
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
    if (initialWork && !archiveMode) {
      setSubmitError("已有游戏文件，不能切换到外链类型。");
      return;
    }
    if (!archiveMode) {
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
      setSubmitError("添加预览图时须同时更新封面图。");
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
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="m-0 text-base font-bold">可继续的上传</h2>
          </header>
          <ul className="divide-y divide-border px-4">
            {relevantDrafts.map((draft) => {
              const committing = upload.committingDraftIds.includes(draft.serverImportJobId);
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  key={draft.key}
                >
                  <div className="min-w-0">
                    <strong className="block truncate">{draft.preparedSource.sourceName}</strong>
                    <p className="mt-1 text-sm text-muted">
                      {committing
                        ? "正在提交，暂时不能继续编辑"
                        : `游戏文件已就绪 · ${formatDate(draft.updatedAt)}`}
                    </p>
                  </div>
                  {!committing ? (
                    <div className="flex gap-2">
                      <Button onClick={() => void restore(draft)} size="sm" type="button">
                        继续填写
                      </Button>
                      <Button
                        onClick={() => void upload.discardDraft(draft)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        放弃
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {upload.controllerError ? (
        <p className="border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
          {upload.controllerError}
        </p>
      ) : null}

      <form onSubmit={onSubmit}>
        <section className="overflow-visible rounded-lg border border-border bg-card shadow-sm">
          <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-start sm:gap-x-3">
            <span className="text-sm font-bold sm:pt-2">游戏引擎</span>
            <EnginePicker
              disabled={metadataLocked}
              disabledReason={(option) => {
                if (option.distribution === "archive" && !canArchiveUpload) {
                  return "当前账户没有本站归档上传权限";
                }
                const targetArchive = option.distribution === "archive";
                if (targetArchive === archiveMode) return null;
                if (gameFileLocksType) return "已有游戏文件，不能切换到外链类型";
                if (externalLinkLocksType) return "请先清空外部下载链接再切换到保存库类型";
                return null;
              }}
              onValueChange={(engineFamily) => {
                setSubmitError(null);
                setForm((current) => ({ ...current, engineFamily }));
              }}
              value={form.engineFamily}
            />
          </div>

          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 divide-y divide-border">
              <section className="p-4 sm:p-5">
                {archiveMode ? (
                  <ArchiveSourceSection
                    disabled={preparing || Boolean(sourceSummary) || upload.active}
                    mode={mode}
                    onCancel={() => void upload.cancelTask()}
                    onDrop={onSourceDrop}
                    onFolder={(files, sourceName) => void startFolder(files, sourceName)}
                    onModeChange={setMode}
                    onRestart={restart}
                    onZip={(file) =>
                      startSource("zip", file.name, [{ file, relativePath: file.name }])
                    }
                    sourceSummary={sourceSummary}
                    task={upload.task}
                  />
                ) : (
                  <ExternalSourceSection
                    disabled={formDisabled}
                    onChange={(externalDownloadUrl) =>
                      setForm((current) => ({ ...current, externalDownloadUrl }))
                    }
                    value={form.externalDownloadUrl}
                  />
                )}
              </section>

              <section className="p-4 sm:p-5">
                {upload.metadataConfirmed ? (
                  <div className="grid min-h-44 place-items-center text-center">
                    <div>
                      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700">
                        <Check className="size-5" />
                      </span>
                      <h2 className="m-0 text-lg font-bold">作品资料已确认</h2>
                      <p className="mt-1 text-sm text-muted">
                        {form.chineseTitle.trim() || form.originalTitle.trim()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <MetadataFields
                    disabled={preparing}
                    form={form}
                    imageSelections={imageSelections}
                    initialWork={initialWork}
                    setForm={setForm}
                    setImageSelections={setImageSelections}
                    suggestions={suggestions}
                  />
                )}
              </section>
            </div>

            <aside className="min-w-0 border-t border-border bg-background/40 lg:border-l lg:border-t-0">
              <div className="lg:sticky lg:top-16">
                <div className="border-b border-border p-4">
                  <CoverPicker
                    disabled={formDisabled}
                    existingBlobSha256={initialWork?.previewBlobSha256s[0]}
                    file={imageSelections.cover}
                    onChange={(cover) =>
                      setImageSelections((current) => ({ ...current, cover }))
                    }
                    required={!initialWork}
                  />
                  {initialWork ? (
                    <p className="mt-2 text-xs text-muted">
                      不选择则保留现有封面；添加预览图时须同时更新封面。
                    </p>
                  ) : null}
                </div>

                <div className="border-b border-border p-4">
                  <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.12em] text-muted">
                    准备状态
                  </p>
                  <ReadinessList
                    archiveMode={archiveMode}
                    metadataConfirmed={upload.metadataConfirmed}
                    preparing={preparing}
                    sourceSummary={sourceSummary}
                    task={upload.task}
                  />
                </div>

                <fieldset className="grid gap-4 border-b border-border p-4" disabled={formDisabled}>
                  <div className="grid gap-2">
                    <span className="text-sm font-bold">游戏语言 <span className="text-accent">*</span></span>
                    <LanguageField
                      onValueChange={(language) =>
                        setForm((current) => ({ ...current, language }))
                      }
                      value={form.language}
                    />
                  </div>
                  {initialWork ? (
                    <div className="grid gap-2">
                      <Label className="font-bold">公开状态</Label>
                      <SelectField
                        onValueChange={(status) =>
                          setForm((current) => ({
                            ...current,
                            status: status as "published" | "hidden",
                          }))
                        }
                        options={[
                          { value: "published", label: "已发布" },
                          { value: "hidden", label: "隐藏" },
                        ]}
                        value={form.status}
                      />
                    </div>
                  ) : null}
                </fieldset>

                <div className="grid gap-3 p-4">
                  {submitError ? (
                    <p className="border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
                      {submitError}
                    </p>
                  ) : null}
                  {upload.task?.commitStarted && !upload.task.result ? (
                    <p className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                      正在提交，资料已锁定，当前不能取消或离开页面。
                    </p>
                  ) : null}
                  {archiveMode && upload.metadataConfirmed ? (
                    <Button
                      className="min-h-12 w-full"
                      disabled={Boolean(upload.task?.commitStarted)}
                      onClick={upload.revokeMetadata}
                      type="button"
                      variant="rm2k"
                    >
                      {upload.task?.commitStarted ? "正在提交…" : "修改资料"}
                    </Button>
                  ) : (
                    <Button
                      className="min-h-12 w-full"
                      disabled={preparing}
                      type="submit"
                      variant="rm2k"
                    >
                      {preparing
                        ? archiveMode
                          ? "正在确认…"
                          : "正在发布…"
                        : archiveMode
                          ? "确认作品资料"
                          : "发布外链作品"}
                    </Button>
                  )}
                  {initialWork ? (
                    <Link
                      className={buttonVariants({ className: "w-full", variant: "outline" })}
                      href={`/me/uploads/${initialWork.id}`}
                    >
                      只维护资料
                    </Link>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </form>
    </div>
  );
}

function ArchiveSourceSection({
  disabled,
  mode,
  onCancel,
  onDrop,
  onFolder,
  onModeChange,
  onRestart,
  onZip,
  sourceSummary,
  task,
}: {
  disabled: boolean;
  mode: UploadSourceKind;
  onCancel: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFolder: (files: UploadSourceFile[], sourceName: string) => void;
  onModeChange: (mode: UploadSourceKind) => void;
  onRestart: () => void;
  onZip: (file: File) => void;
  sourceSummary: { name: string; fileCount: number; sizeBytes: number } | null;
  task: BrowserUploadTaskSnapshot | null;
}) {
  return (
    <div>
      <h2 className="mb-4 text-lg font-bold">游戏文件</h2>
      {sourceSummary ? (
        <UploadTaskCard
          mode={mode}
          onCancel={onCancel}
          onRestart={onRestart}
          sourceSummary={sourceSummary}
          task={task}
        />
      ) : (
        <div
          className={cn(
            "grid min-h-52 place-items-center rounded-lg border-2 border-dashed border-border bg-background p-5 text-center",
            disabled && "opacity-60",
          )}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void onDrop(event)}
        >
          <div className="grid justify-items-center gap-2">
            <Upload className="size-8 text-primary" />
            <strong>拖入游戏文件夹或 ZIP 压缩包</strong>
            <span className="text-sm text-muted">文件夹根目录或 ZIP 内须包含 RPG_RT.lmt</span>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <FilePicker
                accept=".zip,application/zip"
                disabled={disabled}
                label="选择 ZIP"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onModeChange("zip");
                    onZip(file);
                  }
                }}
              />
              <FilePicker
                directory
                disabled={disabled}
                label="以文件夹方式选择"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  onModeChange("folder");
                  onFolder(
                    files.map((file) => ({ file, relativePath: webkitPath(file) })),
                    folderNameFromPicker(files),
                  );
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExternalSourceSection({ disabled, onChange, value }: {
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div>
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
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://"
          required
          type="url"
          value={value}
        />
      </div>
    </div>
  );
}

function MetadataFields({
  disabled,
  form,
  imageSelections,
  initialWork,
  setForm,
  setImageSelections,
  suggestions,
}: {
  disabled: boolean;
  form: FlatMetadata;
  imageSelections: ImageSelections;
  initialWork: UploadInitialWork | null;
  setForm: Dispatch<SetStateAction<FlatMetadata>>;
  setImageSelections: Dispatch<SetStateAction<ImageSelections>>;
  suggestions: {
    tags: UploadTaxonomySuggestion[];
    characters: UploadTaxonomySuggestion[];
  };
}) {
  return (
    <div>
      <h2 className="mb-4 text-lg font-bold">作品资料</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <WorkbenchField controlId="upload-chinese-title" label="中文名">
          <Input disabled={disabled} id="upload-chinese-title" onChange={(event) => setForm((current) => ({ ...current, chineseTitle: event.target.value }))} value={form.chineseTitle} />
        </WorkbenchField>
        <WorkbenchField controlId="upload-original-title" label="原名" required>
          <Input disabled={disabled} id="upload-original-title" onChange={(event) => setForm((current) => ({ ...current, originalTitle: event.target.value }))} required value={form.originalTitle} />
        </WorkbenchField>
        <WorkbenchField className="md:col-span-2" controlId="upload-author" label="作者">
          <div className="grid gap-2">
            <Input disabled={disabled} id="upload-author" onChange={(event) => setForm((current) => ({ ...current, creatorNames: event.target.value }))} value={form.creatorNames} />
            <Label className="flex w-fit items-center gap-2 text-xs font-semibold text-red-700">
              <Checkbox checked={form.isOriginal} className="data-[state=checked]:border-red-700 data-[state=checked]:bg-red-700" disabled={disabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, isOriginal: checked === true }))} />
              本作品为我原创。
            </Label>
          </div>
        </WorkbenchField>
        <WorkbenchField className="md:col-span-2" controlId="upload-description" label="简介">
          <Textarea disabled={disabled} id="upload-description" onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={4} value={form.description} />
        </WorkbenchField>
        <WorkbenchField className="md:col-span-2" controlId="upload-tags" label="标签">
          <TokenPicker disabled={disabled} id="upload-tags" onChange={(tags) => setForm((current) => ({ ...current, tags }))} placeholder="搜索或创建标签" recommendationLabel="推荐标签" suggestions={suggestions.tags} values={form.tags} />
        </WorkbenchField>
        <WorkbenchField className="md:col-span-2" controlId="upload-characters" label="登场角色">
          <TokenPicker disabled={disabled} id="upload-characters" onChange={(characters) => setForm((current) => ({ ...current, characters }))} placeholder="搜索或添加角色" recommendationLabel="常用角色" suggestions={suggestions.characters} values={form.characters} />
        </WorkbenchField>
        <details className="md:col-span-2">
          <summary className="cursor-pointer py-1 text-sm font-bold">更多设置</summary>
          <div className="mt-3 grid gap-4 border-t border-border pt-4 md:grid-cols-2">
            <WorkbenchField className="md:col-span-2" label="预览图">
              <PreviewPicker disabled={disabled} existingCount={Math.max(0, (initialWork?.previewBlobSha256s.length ?? 0) - 1)} files={imageSelections.browsingImages} onChange={(browsingImages) => setImageSelections((current) => ({ ...current, browsingImages }))} />
            </WorkbenchField>
            <WorkbenchField controlId="upload-aliases" label="别名">
              <Textarea disabled={disabled} id="upload-aliases" onChange={(event) => setForm((current) => ({ ...current, aliasTitles: event.target.value }))} rows={3} value={form.aliasTitles} />
            </WorkbenchField>
            {!initialWork ? (
              <WorkbenchField controlId="upload-creator-url" label="作者链接">
                <Input disabled={disabled} id="upload-creator-url" onChange={(event) => setForm((current) => ({ ...current, creatorUrl: event.target.value }))} type="url" value={form.creatorUrl} />
              </WorkbenchField>
            ) : null}
            {isArchiveEngineFamily(form.engineFamily) ? (
              <>
                <WorkbenchField controlId="upload-source-name" label="来源名">
                  <Input disabled={disabled} id="upload-source-name" onChange={(event) => setForm((current) => ({ ...current, sourceName: event.target.value }))} value={form.sourceName} />
                </WorkbenchField>
                <WorkbenchField controlId="upload-source-url" label="来源链接">
                  <Input disabled={disabled} id="upload-source-url" onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))} type="url" value={form.sourceUrl} />
                </WorkbenchField>
              </>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}

function UploadTaskCard({ mode, onCancel, onRestart, sourceSummary, task }: {
  mode: UploadSourceKind;
  onCancel: () => void;
  onRestart: () => void;
  sourceSummary: { name: string; fileCount: number; sizeBytes: number };
  task: BrowserUploadTaskSnapshot | null;
}) {
  const progress = Math.min(100, task?.progress.percent ?? 0);
  const canCancel = Boolean(task && ["running", "waiting"].includes(task.status) && task.phase !== "committing");
  const canRestart = Boolean(task && ["failed", "canceled"].includes(task.status));
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="p-4">
        <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary">
            {mode === "folder" ? <FolderOpen className="size-5" /> : <FileArchive className="size-5" />}
          </span>
          <span className="min-w-0">
            <strong className="block truncate">{sourceSummary.name}</strong>
            <span className="mt-0.5 block text-xs text-muted">
              {mode === "folder" ? "文件夹" : "ZIP 压缩包"} · {sourceSummary.fileCount.toLocaleString("zh-CN")} 个文件 · {formatBytes(sourceSummary.sizeBytes)}
            </span>
          </span>
          <strong className="font-mono text-lg">{Math.round(progress)}%</strong>
        </div>
        <Progress aria-label="上传进度" className="mt-4" value={progress} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <strong>{task ? phaseLabel(task.phase) : "准备上传"}</strong>
          {task?.progress.currentPath ? <span className="max-w-full truncate font-mono">{task.progress.currentPath}</span> : null}
        </div>
        {task?.error ? <p className="mt-3 border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{task.error}</p> : null}
        {task?.result ? <p className="mt-3 border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">上传完成。<Link className="font-semibold underline" href={`/games/${task.result.workId}`}>查看作品</Link></p> : null}
      </div>
      {canCancel || canRestart ? (
        <footer className="flex justify-end gap-2 border-t border-border bg-background/60 px-4 py-3">
          {canCancel ? <Button onClick={onCancel} size="sm" type="button" variant="outline">取消上传</Button> : null}
          {canRestart ? <Button onClick={onRestart} size="sm" type="button">重新开始</Button> : null}
        </footer>
      ) : null}
    </article>
  );
}

function ReadinessList({ archiveMode, metadataConfirmed, preparing, sourceSummary, task }: {
  archiveMode: boolean;
  metadataConfirmed: boolean;
  preparing: boolean;
  sourceSummary: { name: string; fileCount: number; sizeBytes: number } | null;
  task: BrowserUploadTaskSnapshot | null;
}) {
  const items = archiveMode
    ? [
        { label: "游戏文件", value: task?.sourceReady ? "已就绪" : task ? phaseLabel(task.phase) : sourceSummary ? "准备中" : "尚未选择", tone: task?.sourceReady ? "ready" : task ? "running" : "idle" },
        { label: "作品资料", value: task?.commitStarted ? "已锁定" : metadataConfirmed ? "已确认" : "编辑中", tone: metadataConfirmed ? "ready" : "idle" },
        { label: "发布", value: task?.result ? "已完成" : task?.commitStarted ? phaseLabel(task.phase) : task?.sourceReady && !metadataConfirmed ? "等待作品资料" : !task?.sourceReady && metadataConfirmed ? "等待游戏文件" : "等待两项就绪", tone: task?.result ? "ready" : task?.commitStarted ? "running" : "idle" },
      ]
    : [
        { label: "作品资料", value: preparing ? "正在发布" : "编辑中", tone: preparing ? "running" : "idle" },
        { label: "发布", value: preparing ? "提交中" : "等待发布", tone: preparing ? "running" : "idle" },
      ];
  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <div className="grid grid-cols-[10px_minmax(0,1fr)] items-start gap-2.5" key={item.label}>
          <span className={cn("mt-1.5 size-2.5 rounded-full bg-muted/40", item.tone === "ready" && "bg-emerald-500", item.tone === "running" && "animate-pulse bg-primary")} />
          <span><strong className="block text-sm">{item.label}</strong><span className="block text-xs text-muted">{item.value}</span></span>
        </div>
      ))}
    </div>
  );
}

function initialForm(work: UploadInitialWork | null, canArchiveUpload: boolean): FlatMetadata {
  return {
    originalTitle: work?.originalTitle ?? "",
    chineseTitle: work?.chineseTitle ?? "",
    aliasTitles: work?.aliases.join("\n") ?? "",
    engineFamily: work?.engineFamily ?? (canArchiveUpload ? "rpg_maker_2000" : "other"),
    description: work?.description ?? "",
    tags: work?.tags ?? [],
    characters: work?.characterCredits.map((character) => character.name) ?? [],
    creatorNames: work?.authorCredits.map((author) => author.creator.name).join(", ") ?? "",
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
  return work ? { characters: work.characterCredits, authors: work.authorCredits } : { characters: [], authors: [] };
}

function associationsFromMetadata(metadata: ArchiveCommitMetadata): AssociationDefaults {
  const creators = new Map(metadata.creators.map((creator) => [entityNameKey(creator.name), creator]));
  return {
    characters: metadata.characters ?? [],
    authors: metadata.workStaff.filter((staff) => staff.roleKey === "author").map((staff) => ({
      creator: creators.get(entityNameKey(staff.creatorName)) ?? { name: staff.creatorName, originalName: null, websiteUrl: null, extra: {} },
      staff,
    })),
  };
}

function formFromMetadata(metadata: ArchiveCommitMetadata): FlatMetadata {
  const authorNames = metadata.workStaff.filter((staff) => staff.roleKey === "author").map((staff) => staff.creatorName);
  const creator = metadata.creators.find((item) => entityNameKey(item.name) === entityNameKey(authorNames[0] ?? ""));
  return {
    originalTitle: metadata.game.originalTitle,
    chineseTitle: metadata.game.chineseTitle ?? "",
    aliasTitles: metadata.workTitles.map((item) => item.title).join("\n"),
    engineFamily: metadata.game.engineFamily,
    description: metadata.game.description ?? "",
    tags: metadata.tags,
    characters: (metadata.characters ?? []).map((item) => item.name),
    creatorNames: authorNames.join(", "),
    creatorUrl: creator?.websiteUrl ?? "",
    isOriginal: metadata.game.isOriginal,
    language: metadata.game.language,
    sourceName: metadata.archiveVersion.sourceName ?? "",
    sourceUrl: metadata.archiveVersion.sourceUrl ?? "",
    externalDownloadUrl: "",
    status: metadata.game.status === "hidden" ? "hidden" : "published",
  };
}

function buildMetadata(form: FlatMetadata, imageHashes: { browsingImageBlobSha256s: string[] }, targetWorkId: number | null, defaults: AssociationDefaults): ArchiveCommitMetadata {
  const characterDefaults = new Map(defaults.characters.map((character) => [entityNameKey(character.name), character]));
  const characters = uniqueTokens(form.characters).map((name, index) => {
    const existing = characterDefaults.get(entityNameKey(name));
    return { name, originalName: existing?.originalName ?? null, roleKey: existing?.roleKey ?? "supporting", spoilerLevel: existing?.spoilerLevel ?? 0, sortOrder: index + 1, notes: existing?.notes ?? null } satisfies CharacterCredit;
  });
  const authorDefaults = new Map(defaults.authors.map((author) => [entityNameKey(author.creator.name), author]));
  const authorNames = parseList(form.creatorNames);
  const creators = authorNames.map((name, index) => {
    const existing = authorDefaults.get(entityNameKey(name));
    return { name, originalName: existing?.creator.originalName ?? null, websiteUrl: existing?.creator.websiteUrl ?? (!targetWorkId && index === 0 ? cleanNullable(form.creatorUrl) : null), extra: existing?.creator.extra ?? {} } satisfies CreatorCredit;
  });
  const workStaff = authorNames.map((creatorName) => {
    const existing = authorDefaults.get(entityNameKey(creatorName));
    return { creatorName, roleKey: "author", roleLabel: existing?.staff.roleLabel ?? "作者", notes: existing?.staff.notes ?? null } satisfies WorkStaffCredit;
  });
  return {
    game: { originalTitle: form.originalTitle.trim(), chineseTitle: cleanNullable(form.chineseTitle), description: cleanNullable(form.description), originalReleaseDate: null, originalReleasePrecision: "unknown", engineFamily: form.engineFamily, isOriginal: form.isOriginal, language: form.language, browsingImageBlobSha256s: imageHashes.browsingImageBlobSha256s, status: form.status, extra: {} },
    target: { mode: targetWorkId ? "update" : "create", workId: targetWorkId },
    archiveVersion: { sourceName: cleanNullable(form.sourceName), sourceUrl: cleanNullable(form.sourceUrl) },
    workTitles: parseList(form.aliasTitles).map((title) => ({ title, language: null, titleType: "alias" })),
    characters,
    creators,
    workStaff,
    tags: uniqueTokens(form.tags),
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
  body.set("tags", form.tags.join("\n"));
  body.set("characters", form.characters.join("\n"));
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

function FilePicker({ accept, directory = false, disabled = false, label, multiple = false, onChange }: {
  accept?: string;
  directory?: boolean;
  disabled?: boolean;
  label: string;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const id = useId();
  return <div><Button asChild className={disabled ? "pointer-events-none opacity-50" : undefined} size="sm" variant="outline"><Label aria-disabled={disabled || undefined} className="cursor-pointer" htmlFor={id}>{label}</Label></Button><input accept={accept} className="sr-only" disabled={disabled} id={id} multiple={multiple} onChange={onChange} type="file" {...(directory ? { webkitdirectory: "", directory: "" } : {})} /></div>;
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
  const entries = Array.from(dataTransfer.items).map((item): DroppedEntry | null => {
    const getEntry = (item as unknown as { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry;
    return getEntry?.call(item) ?? null;
  }).filter((entry): entry is DroppedEntry => entry !== null);
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
function entityNameKey(value: string): string { return value.toLocaleLowerCase(); }
function cleanNullable(value: string): string | null { return value.trim() || null; }
function parseList(value: string): string[] { return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))]; }
function uniqueTokens(values: string[]): string[] { const seen = new Set<string>(); return values.filter((value) => { const key = entityNameKey(value.trim()); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function phaseLabel(phase: string): string {
  const labels: Record<string, string> = { enumerating: "读取文件", hashing: "校验文件", building_core_pack: "整理公共文件", creating_import_job: "创建上传任务", preflighting: "检查已有对象", uploading_source: "上传游戏文件", verifying_source: "确认游戏文件", awaiting_metadata: "等待作品资料", uploading_metadata: "上传资料图片", committing: "提交入库", completed: "完成" };
  return labels[phase] ?? "准备";
}
