"use client";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { SelectField } from "@/app/components/ui/select";
import { Checkbox } from "@/app/components/ui/checkbox";

import {
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import { useUploadTasks } from "@/app/upload/upload-task-provider";
import { formatBytes } from "@/lib/format";
import { FormField } from "@/app/components/ui/form-field";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatList } from "@/app/components/ui/stat-list";
import { isPermissionKey } from "@/lib/authz/permissions";
import type { MetadataBlobUpload } from "@/app/upload/upload-types";

type FileInputMode = "folder" | "zip";
type EngineFamily = "rpg_maker_2000" | "rpg_maker_2003";
type ReleaseBaseVariant = ArchiveCommitMetadata["release"]["baseVariant"];
type ReleaseType = ArchiveCommitMetadata["release"]["type"];

type FlatMetadata = {
  workSlug: string;
  originalTitle: string;
  chineseTitle: string;
  aliasTitles: string;
  sortTitle: string;
  engineFamily: EngineFamily;
  description: string;
  tags: string;
  characters: string;
  creatorName: string;
  creatorSlug: string;
  creatorUrl: string;
  usesManiacsPatch: boolean;
  baseVariant: ReleaseBaseVariant;
  releaseType: ReleaseType;
  variantLabel: string;
  archiveVariantLabel: string;
  language: string;
  releaseDate: string;
  sourceName: string;
  sourceUrl: string;
  executablePath: string;
  rightsNotes: string;
  isProofread: boolean;
  isImageEdited: boolean;
};

type WorkLookupResult = {
  id: number;
  slug: string;
  originalTitle: string;
  chineseTitle: string | null;
  aliases: string[];
  sortTitle: string | null;
  description: string | null;
  engineFamily: EngineFamily | "mixed" | "unknown" | "other";
  engineDetail: string | null;
  usesManiacsPatch: boolean;
  iconBlobSha256: string | null;
  thumbnailBlobSha256: string | null;
  releases: WorkReleaseLookupResult[];
};

type WorkReleaseLookupResult = {
  id: number;
  key: string;
  label: string;
  baseVariant: ReleaseBaseVariant;
  variantLabel: string;
  type: ReleaseType;
  releaseDate: string | null;
  releaseDatePrecision: ArchiveCommitMetadata["release"]["releaseDatePrecision"];
  sourceName: string | null;
  sourceUrl: string | null;
  executablePath: string | null;
  rightsNotes: string | null;
};

type CurrentUser = {
  email: string;
  displayName: string;
  roleKeys: string[];
  permissionKeys: string[];
};

type ImageSelections = {
  icon: File | null;
  thumbnail: File | null;
  browsingImages: File[];
};

type ImageHashes = {
  iconBlobSha256: string | null;
  thumbnailBlobSha256: string | null;
  browsingImageBlobSha256s: string[];
};

type PreparedImages = { hashes: ImageHashes; blobs: MetadataBlobUpload[] };

const defaultForm: FlatMetadata = {
  workSlug: "",
  originalTitle: "",
  chineseTitle: "",
  aliasTitles: "",
  sortTitle: "",
  engineFamily: "rpg_maker_2000",
  description: "",
  tags: "",
  characters: "",
  creatorName: "",
  creatorSlug: "",
  creatorUrl: "",
  usesManiacsPatch: false,
  baseVariant: "original",
  releaseType: "translation",
  variantLabel: "默认版",
  archiveVariantLabel: "默认版",
  language: "zh-Hans",
  releaseDate: localDateString(),
  sourceName: "",
  sourceUrl: "",
  executablePath: "RPG_RT.exe",
  rightsNotes: "",
  isProofread: false,
  isImageEdited: false,
};

const languageOptions = [
  { value: "zh-Hans", label: "中文" },
  { value: "ja", label: "日文" },
  { value: "en", label: "英文" },
];

const baseVariantOptions: Array<{ value: ReleaseBaseVariant; label: string }> = [
  { value: "original", label: "原版" },
  { value: "remake", label: "重制版" },
  { value: "other", label: "其他基底" },
];

const releaseTypeOptions: Array<{ value: ReleaseType; label: string }> = [
  { value: "original", label: "原始发布" },
  { value: "translation", label: "汉化版" },
  { value: "revision", label: "修正版" },
  { value: "localized_revision", label: "本地化修正版" },
  { value: "demo", label: "试玩版" },
  { value: "event_submission", label: "活动投稿" },
  { value: "patch_applied_full_release", label: "补丁整合版" },
  { value: "repack", label: "重打包" },
  { value: "other", label: "其他" },
];

export function UploadClient({ currentUser }: { currentUser: CurrentUser }) {
  const { tasks, startUpload } = useUploadTasks();
  const [mode, setMode] = useState<FileInputMode>("folder");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [resumeLocalTaskId, setResumeLocalTaskId] = useState<string>("");
  const [form, setForm] = useState<FlatMetadata>(defaultForm);
  const [imageSelections, setImageSelections] = useState<ImageSelections>({
    icon: null,
    thumbnail: null,
    browsingImages: [],
  });
  const [lookupState, setLookupState] = useState<{
    loading: boolean;
    results: WorkLookupResult[];
    selectedWorkId: number | null;
    selectedReleaseId: number | null;
  }>({
    loading: false,
    results: [],
    selectedWorkId: null,
    selectedReleaseId: null,
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const recoverableTasks = useMemo(
    () => tasks.filter((task) => ["needs_source_reselect", "failed_recoverable", "paused"].includes(task.status)),
    [tasks],
  );
  const selectedSourceSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const selectedWork = lookupState.results.find((work) => work.id === lookupState.selectedWorkId) ?? null;
  const releaseOptions = selectedWork?.releases ?? [];
  const isAdmin = currentUser?.permissionKeys.some((key) => isPermissionKey(key) && key === "work.update") ?? false;

  useEffect(() => {
    const title = form.originalTitle.trim();

    if (!title) {
      return;
    }

    const timer = window.setTimeout(() => {
      setLookupState((current) => ({ ...current, loading: true }));
      fetch(`/api/works/lookup?title=${encodeURIComponent(title)}`)
        .then(async (response) =>
          response.ok
            ? ((await response.json()) as {
                ok: true;
                works: WorkLookupResult[];
              })
            : null,
        )
        .then((body) => {
          setLookupState((current) => ({
            ...current,
            loading: false,
            results: body?.ok ? body.works : [],
          }));
        })
        .catch(() => {
          setLookupState((current) => ({
            ...current,
            loading: false,
            results: [],
          }));
        });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [form.originalTitle]);

  function onSourceFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFiles(Array.from(event.target.files ?? []));
  }

  function onOriginalTitleChange(value: string) {
    setLookupState((current) => ({
      ...current,
      selectedWorkId: null,
      selectedReleaseId: null,
    }));
    setForm((current) => ({
      ...current,
      originalTitle: value,
      workSlug: slugFromTitle(value),
      sortTitle: current.sortTitle || value,
    }));
  }

  function applyExistingWork(work: WorkLookupResult) {
    const engineFamily = work.engineFamily === "rpg_maker_2003" ? "rpg_maker_2003" : "rpg_maker_2000";
    const originalTitle = work.originalTitle;

    setLookupState((current) => ({
      ...current,
      selectedWorkId: work.id,
      selectedReleaseId: null,
    }));
    setForm((current) => ({
      ...current,
      workSlug: work.slug,
      originalTitle,
      chineseTitle: work.chineseTitle ?? "",
      aliasTitles: work.aliases.join("\n"),
      sortTitle: work.sortTitle || current.sortTitle || originalTitle,
      engineFamily,
      description: work.description ?? "",
      usesManiacsPatch: work.usesManiacsPatch,
    }));
  }

  function applyExistingRelease(releaseId: string) {
    const release = releaseOptions.find((item) => String(item.id) === releaseId);

    setLookupState((current) => ({
      ...current,
      selectedReleaseId: release?.id ?? null,
    }));

    if (!release) {
      return;
    }

    setForm((current) => ({
      ...current,
      baseVariant: release.baseVariant,
      releaseType: release.type,
      variantLabel: release.variantLabel,
      releaseDate: release.releaseDate || current.releaseDate,
      sourceName: release.sourceName || "",
      sourceUrl: release.sourceUrl || "",
      executablePath: release.executablePath || current.executablePath,
      rightsNotes: release.rightsNotes || "",
    }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (selectedFiles.length === 0) {
      setSubmitError("请先选择游戏目录或 ZIP。");
      return;
    }

    if (!form.originalTitle.trim()) {
      setSubmitError("请填写作品原名。");
      return;
    }

    if (!form.variantLabel.trim()) {
      setSubmitError("请填写版本名称。");
      return;
    }

    if (!form.language.trim()) {
      setSubmitError("请填写版本语言。");
      return;
    }

    if (!form.archiveVariantLabel.trim()) {
      setSubmitError("请填写发布包名称。");
      return;
    }

    setPreparing(true);

    try {
      const preparedImages = await prepareSelectedImages(imageSelections);
      const metadata = buildMetadata(form, preparedImages.hashes);

      startUpload({
        sourceKind: mode,
        files: selectedFiles,
        metadata,
        metadataBlobs: preparedImages.blobs,
        resumeLocalTaskId: resumeLocalTaskId || null,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "准备上传失败。");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <aside className="rounded-lg border border-border bg-card p-4">
        <Pane>
          <SectionHeading eyebrow="上传来源" title="游戏文件" />
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="源类型">
            <Button
              className={mode === "folder" ? "text-primary underline decoration-2 underline-offset-4" : ""}
              onClick={() => setMode("folder")}
              type="button"
            >
              文件夹
            </Button>
            <Button
              className={mode === "zip" ? "text-primary underline decoration-2 underline-offset-4" : ""}
              onClick={() => setMode("zip")}
              type="button"
            >
              本地 ZIP
            </Button>
          </div>

          {mode === "folder" ? (
            <FilePicker accept="" directory label="选择游戏目录" multiple onChange={onSourceFileChange} />
          ) : (
            <FilePicker accept=".zip,application/zip" label="选择本地 ZIP" onChange={onSourceFileChange} />
          )}

          <StatList
            columns={2}
            items={[
              {
                label: "已选择",
                value: `${selectedFiles.length.toLocaleString("zh-CN")} 个文件`,
              },
              { label: "总大小", value: formatBytes(selectedSourceSize) },
            ]}
            variant="tiles"
          />

          {recoverableTasks.length > 0 ? (
            <FormField label="恢复任务">
              <SelectField
                onValueChange={setResumeLocalTaskId}
                options={[
                  { value: "", label: "作为新任务导入" },
                  ...recoverableTasks.map((task) => ({
                    value: task.localTaskId,
                    label: `恢复 ${task.sourceName} / ${Math.round(task.progress.percent)}%`,
                  })),
                ]}
                value={resumeLocalTaskId}
              />
            </FormField>
          ) : null}
        </Pane>
      </aside>

      <form className="grid gap-4" onSubmit={onSubmit}>
        <Pane>
          <SectionHeading eyebrow="第一步" title="作品" />

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="原名 *">
              <Input
                onChange={(event) => onOriginalTitleChange(event.target.value)}
                required
                type="text"
                value={form.originalTitle}
              />
            </FormField>
            <FormField label="游戏引擎 *">
              <SelectField
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    engineFamily: value as EngineFamily,
                  }))
                }
                options={[
                  { value: "rpg_maker_2000", label: "RPG Maker 2000" },
                  { value: "rpg_maker_2003", label: "RPG Maker 2003" },
                ]}
                required
                value={form.engineFamily}
              />
            </FormField>
            <TextField form={form} label="中文名" name="chineseTitle" setForm={setForm} />
            <div className="bg-muted/10">
              <FormField label="网址标识">
                <Input readOnly type="text" value={form.workSlug} />
              </FormField>
            </div>
          </div>

          {lookupState.loading ? <p className="text-sm text-muted">正在查找同名作品…</p> : null}
          {lookupState.results.length > 0 && !selectedWork ? (
            <div className="grid gap-3 rounded-lg border border-border bg-card p-4">
              <strong>资料库中可能已有同名作品</strong>
              {lookupState.results.map((work) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0"
                  key={work.id}
                >
                  <div>
                    <span>{work.originalTitle}</span>
                    <small>{work.slug}</small>
                  </div>
                  <Button onClick={() => applyExistingWork(work)} type="button">
                    关联此作品
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          {selectedWork ? (
            <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-800 text-sm">
              已关联已有作品：{selectedWork.originalTitle}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="flex min-h-10 items-center gap-2">
              <Checkbox
                checked={form.usesManiacsPatch}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    usesManiacsPatch: checked === true,
                  }))
                }
              />
              Maniacs Patch
            </Label>
          </div>

          <div className="grid gap-4 md:grid-cols-2 grid gap-3 sm:grid-cols-3">
            <ImageField
              label="图标"
              onChange={(file) => setImageSelections((current) => ({ ...current, icon: file }))}
            />
            <ImageField
              label="预览图"
              onChange={(file) =>
                setImageSelections((current) => ({
                  ...current,
                  thumbnail: file,
                }))
              }
            />
            <FormField label="浏览图" wide>
              <FilePicker
                accept="image/*"
                label="选择浏览图"
                multiple
                onChange={(event) =>
                  setImageSelections((current) => ({
                    ...current,
                    browsingImages: Array.from(event.target.files ?? []),
                  }))
                }
              />
            </FormField>
          </div>

          <details className="grid gap-2">
            <summary>更多作品信息</summary>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField form={form} label="排序标题" name="sortTitle" setForm={setForm} />
              <TextAreaField form={form} label="别名" name="aliasTitles" setForm={setForm} />
              <TextField form={form} label="标签" name="tags" setForm={setForm} />
              <TextAreaField form={form} label="登场角色" name="characters" setForm={setForm} />
              <TextField form={form} label="作者名" name="creatorName" setForm={setForm} />
              <TextField form={form} label="作者链接" name="creatorUrl" setForm={setForm} />
            </div>
            <FormField label="简介">
              <Textarea
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={4}
                value={form.description}
              />
            </FormField>
          </details>
        </Pane>

        <Pane>
          <SectionHeading eyebrow="第二步" title="发布版本" />

          {releaseOptions.length > 0 ? (
            <FormField label="使用已有发布版本">
              <SelectField
                onValueChange={applyExistingRelease}
                options={[
                  { value: "", label: "创建新发布版本" },
                  ...releaseOptions.map((release) => ({
                    value: String(release.id),
                    label: `${release.label}${isAdmin ? ` / ${release.key}` : ""}`,
                  })),
                ]}
                value={lookupState.selectedReleaseId ? String(lookupState.selectedReleaseId) : ""}
              />
            </FormField>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="基底版本 *">
              <SelectField
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    baseVariant: value as ReleaseBaseVariant,
                  }))
                }
                options={baseVariantOptions}
                required
                value={form.baseVariant}
              />
            </FormField>
            <FormField label="发布类型 *">
              <SelectField
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    releaseType: value as ReleaseType,
                  }))
                }
                options={releaseTypeOptions}
                required
                value={form.releaseType}
              />
            </FormField>
            <FormField label="版本名称 *">
              <Input
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    variantLabel: event.target.value,
                  }))
                }
                placeholder="例：默认版"
                required
                type="text"
                value={form.variantLabel}
              />
            </FormField>
            <FormField label="发布日期">
              <Input
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    releaseDate: event.target.value,
                  }))
                }
                type="date"
                value={form.releaseDate}
              />
            </FormField>
            <div className="bg-muted/10">
              <FormField label="上传者">
                <Input readOnly type="text" value={currentUser?.displayName || currentUser?.email || "当前登录账户"} />
              </FormField>
            </div>
            <div className="bg-muted/10">
              <FormField label="自动版本名称">
                <Input readOnly type="text" value={buildReleaseLabel(form)} />
              </FormField>
            </div>
            {isAdmin ? (
              <div className="bg-muted/10 md:col-span-2">
                <FormField label="版本代码">
                  <Input readOnly type="text" value={buildReleaseKey(form)} />
                </FormField>
              </div>
            ) : null}
          </div>

          <details className="grid gap-2">
            <summary>更多发布信息</summary>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField form={form} label="来源名" name="sourceName" setForm={setForm} />
              <TextField form={form} label="来源链接" name="sourceUrl" setForm={setForm} />
              <TextField form={form} label="可执行入口" name="executablePath" setForm={setForm} />
            </div>
            <FormField label="版权/授权备注">
              <Textarea
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    rightsNotes: event.target.value,
                  }))
                }
                rows={3}
                value={form.rightsNotes}
              />
            </FormField>
          </details>
        </Pane>

        <Pane>
          <SectionHeading eyebrow="第三步" title="文件版本" />
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="版本语言 *">
              <Input
                list="upload-language-options"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    language: event.target.value,
                  }))
                }
                required
                type="text"
                value={form.language}
              />
              <datalist id="upload-language-options">
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </FormField>
            <FormField label="发布包名称 *">
              <Input
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    archiveVariantLabel: event.target.value,
                  }))
                }
                placeholder="例：默认版"
                required
                type="text"
                value={form.archiveVariantLabel}
              />
            </FormField>
            <div className="bg-muted/10">
              <FormField label="自动生成名称">
                <Input readOnly type="text" value={buildArchiveVersionLabel(form)} />
              </FormField>
            </div>
            {isAdmin ? (
              <div className="bg-muted/10 md:col-span-2">
                <FormField label="版本代码">
                  <Input readOnly type="text" value={buildArchiveVersionKey(form)} />
                </FormField>
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="flex min-h-10 items-center gap-2">
              <Checkbox
                checked={form.isProofread}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    isProofread: checked === true,
                  }))
                }
              />
              已校对
            </Label>
            <Label className="flex min-h-10 items-center gap-2">
              <Checkbox
                checked={form.isImageEdited}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    isImageEdited: checked === true,
                  }))
                }
              />
              已修图
            </Label>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {submitError ? (
              <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 text-sm">{submitError}</p>
            ) : null}
            <Button disabled={preparing} type="submit">
              {preparing ? "正在准备…" : "开始导入"}
            </Button>
          </div>
        </Pane>
      </form>
    </div>
  );
}

function TextField({
  form,
  name,
  label,
  setForm,
}: {
  form: FlatMetadata;
  name: keyof FlatMetadata;
  label: string;
  setForm: Dispatch<SetStateAction<FlatMetadata>>;
}) {
  return (
    <FormField label={label}>
      <Input
        name={name}
        onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
        type="text"
        value={String(form[name])}
      />
    </FormField>
  );
}

function TextAreaField({
  form,
  name,
  label,
  setForm,
}: {
  form: FlatMetadata;
  name: keyof FlatMetadata;
  label: string;
  setForm: Dispatch<SetStateAction<FlatMetadata>>;
}) {
  return (
    <FormField label={label}>
      <Textarea
        name={name}
        onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
        rows={3}
        value={String(form[name])}
      />
    </FormField>
  );
}

function ImageField({ label, onChange }: { label: string; onChange: (file: File | null) => void }) {
  return (
    <FormField label={label}>
      <FilePicker
        accept="image/*"
        label={`选择${label}`}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </FormField>
  );
}

function FilePicker({
  accept,
  directory = false,
  label,
  multiple = false,
  onChange,
}: {
  accept: string;
  directory?: boolean;
  label: string;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputId = `file-picker-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <div className="grid gap-3 rounded-lg border-2 border-dashed border-border bg-card p-6 text-center">
      <Button asChild variant="outline">
        <Label className="cursor-pointer" htmlFor={inputId}>
          {label}
        </Label>
      </Button>
      <input
        accept={accept || undefined}
        className="sr-only"
        id={inputId}
        multiple={multiple}
        onChange={onChange}
        type="file"
        {...(directory ? { webkitdirectory: "", directory: "" } : {})}
      />
    </div>
  );
}

function buildMetadata(form: FlatMetadata, imageHashes: ImageHashes): ArchiveCommitMetadata {
  const originalTitle = form.originalTitle.trim();
  const chineseTitle = form.chineseTitle.trim();
  const creatorSlug = form.creatorSlug.trim() || (form.creatorName.trim() ? slugFromTitle(form.creatorName) : "");
  const creator =
    creatorSlug && form.creatorName.trim()
      ? [
          {
            slug: creatorSlug,
            name: form.creatorName.trim(),
            originalName: null,
            websiteUrl: cleanNullable(form.creatorUrl),
            extra: {},
          },
        ]
      : [];
  const releaseLabel = buildReleaseLabel(form);
  const releaseKey = buildReleaseKey(form);
  const archiveVersionLabel = `${buildArchiveVersionLabel(form)}・${timestampLabel()}`;
  const archiveVersionKey = buildArchiveVersionKey(form);
  const sortTitle = cleanNullable(form.sortTitle) ?? (chineseTitle || originalTitle);

  return {
    work: {
      slug: form.workSlug.trim() || slugFromTitle(originalTitle),
      originalTitle,
      chineseTitle: cleanNullable(form.chineseTitle),
      sortTitle,
      description: cleanNullable(form.description),
      originalReleaseDate: null,
      originalReleasePrecision: "unknown",
      engineFamily: form.engineFamily,
      engineDetail: form.engineFamily === "rpg_maker_2003" ? "RPG Maker 2003" : "RPG Maker 2000",
      usesManiacsPatch: form.usesManiacsPatch,
      iconBlobSha256: imageHashes.iconBlobSha256,
      thumbnailBlobSha256: imageHashes.thumbnailBlobSha256,
      browsingImageBlobSha256s: imageHashes.browsingImageBlobSha256s,
      status: "published",
      extra: {},
    },
    release: {
      key: releaseKey,
      label: releaseLabel,
      baseVariant: form.baseVariant,
      variantLabel: form.variantLabel.trim(),
      type: form.releaseType,
      releaseDate: cleanNullable(form.releaseDate),
      releaseDatePrecision: form.releaseDate.trim() ? "day" : "unknown",
      sourceName: cleanNullable(form.sourceName),
      sourceUrl: cleanNullable(form.sourceUrl),
      executablePath: cleanNullable(form.executablePath),
      rightsNotes: cleanNullable(form.rightsNotes),
      status: "published",
      extra: {},
    },
    archiveVersion: {
      key: archiveVersionKey,
      label: archiveVersionLabel,
      variantLabel: form.archiveVariantLabel.trim(),
      language: form.language.trim(),
      isProofread: form.isProofread,
      isImageEdited: form.isImageEdited,
    },
    workTitles: [
      ...parseAliases(form.aliasTitles).map((title) => ({
        title,
        language: null,
        titleType: "alias" as const,
      })),
    ],
    characters: parseCharacterLines(form.characters),
    creators: creator,
    workStaff: creator.length
      ? [
          {
            creatorSlug: creator[0].slug,
            roleKey: "author",
            roleLabel: "作者",
            notes: null,
          },
        ]
      : [],
    releaseStaff: [],
    tags: form.tags
      .split(/[,，\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    externalLinks: {
      work: form.sourceUrl.trim()
        ? [
            {
              label: form.sourceName.trim() || "来源",
              url: form.sourceUrl.trim(),
              linkType: "wiki",
            },
          ]
        : [],
      release: form.sourceUrl.trim()
        ? [
            {
              label: form.sourceName.trim() || "来源",
              url: form.sourceUrl.trim(),
              linkType: "source",
            },
          ]
        : [],
    },
  };
}

async function prepareSelectedImages(input: ImageSelections): Promise<PreparedImages> {
  const blobs: MetadataBlobUpload[] = [];
  const iconBlobSha256 = input.icon ? await prepareMetadataImage(input.icon, blobs) : null;
  const thumbnailBlobSha256 = input.thumbnail ? await prepareMetadataImage(input.thumbnail, blobs) : null;
  const browsingImageBlobSha256s: string[] = [];

  for (const file of input.browsingImages) {
    browsingImageBlobSha256s.push(await prepareMetadataImage(file, blobs));
  }

  return {
    hashes: { iconBlobSha256, thumbnailBlobSha256, browsingImageBlobSha256s },
    blobs: [...new Map(blobs.map((blob) => [blob.sha256, blob])).values()],
  };
}

async function prepareMetadataImage(file: File, blobs: MetadataBlobUpload[]): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} 不是图片文件。`);
  }

  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  blobs.push({ sha256, file, contentType: file.type });
  return sha256;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function cleanNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseAliases(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parseCharacterLines(value: string): NonNullable<ArchiveCommitMetadata["characters"]> {
  return value
    .split(/[,，\n]/)
    .map((item, index) => ({
      name: item.trim(),
      originalName: null,
      roleKey: "supporting" as const,
      spoilerLevel: 0,
      sortOrder: index + 1,
      notes: null,
    }))
    .filter((item) => item.name);
}

function buildReleaseLabel(form: FlatMetadata): string {
  return [baseVariantDisplay(form.baseVariant), releaseTypeShortDisplay(form.releaseType), form.variantLabel.trim()]
    .filter(Boolean)
    .join("・");
}

function buildReleaseKey(form: FlatMetadata): string {
  return [form.baseVariant, form.releaseType, keyPart(form.variantLabel)].join(".");
}

function buildArchiveVersionLabel(form: FlatMetadata): string {
  return [languageDisplay(form.language), archiveQualityDisplay(form), form.archiveVariantLabel.trim()]
    .filter(Boolean)
    .join("・");
}

function buildArchiveVersionKey(form: FlatMetadata): string {
  return [keyPart(form.language), archiveQualityKey(form), keyPart(form.archiveVariantLabel)].join(".");
}

function baseVariantDisplay(value: ReleaseBaseVariant): string {
  return baseVariantOptions.find((option) => option.value === value)?.label ?? value;
}

function releaseTypeShortDisplay(value: ReleaseType): string {
  switch (value) {
    case "original":
      return "原版";
    case "translation":
      return "汉化版";
    case "revision":
      return "修正版";
    case "localized_revision":
      return "本地化修正版";
    case "demo":
      return "试玩版";
    case "event_submission":
      return "活动投稿";
    case "patch_applied_full_release":
      return "补丁整合版";
    case "repack":
      return "重打包";
    case "other":
      return "其他";
  }
}

function archiveQualityDisplay(form: Pick<FlatMetadata, "isProofread" | "isImageEdited">): string {
  if (form.isProofread && form.isImageEdited) {
    return "校对修图";
  }

  if (form.isProofread) {
    return "已校对";
  }

  if (form.isImageEdited) {
    return "已修图";
  }

  return "未校对未修图";
}

function archiveQualityKey(form: Pick<FlatMetadata, "isProofread" | "isImageEdited">): string {
  if (form.isProofread && form.isImageEdited) {
    return "proofread-image";
  }

  if (form.isProofread) {
    return "proofread";
  }

  if (form.isImageEdited) {
    return "image";
  }

  return "raw";
}

function languageDisplay(value: string | null): string {
  const normalized = value?.trim();

  if (!normalized) {
    return "未指定语言";
  }

  return languageOptions.find((option) => option.value === normalized)?.label ?? normalized;
}

function keyPart(value: string): string {
  return slugFromTitle(value) || "unset";
}

function slugFromTitle(title: string): string {
  const normalized = title
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "untitled-work";
}

function localDateString(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function timestampLabel(): string {
  const now = new Date();
  const date = localDateString(now);
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return `${date} ${time}`;
}
