"use client";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { LanguageField } from "@/app/admin/works/language-field";
import { Textarea } from "@/app/components/ui/textarea";
import { SelectField } from "@/app/components/ui/select";
import { Checkbox } from "@/app/components/ui/checkbox";
import { useRouter } from "next/navigation";

import {
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useState,
} from "react";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import { useUploadTasks } from "@/app/upload/upload-task-provider";
import { formatBytes } from "@/lib/format";
import { FormField } from "@/app/components/ui/form-field";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatList } from "@/app/components/ui/stat-list";
import type { MetadataBlobUpload } from "@/app/upload/upload-types";

type FileInputMode = "folder" | "zip";
type EngineFamily =
  | "rpg_maker_2000"
  | "rpg_maker_2003"
  | "rpg_maker_2003_maniac"
  | "rpg_maker_xp"
  | "rpg_maker_vx"
  | "rpg_maker_vx_ace"
  | "rpg_maker_mv"
  | "rpg_maker_mz"
  | "rpg_maker_unite"
  | "mixed"
  | "unknown"
  | "other";
type FlatMetadata = {
  originalTitle: string;
  chineseTitle: string;
  aliasTitles: string;
  engineFamily: EngineFamily;
  description: string;
  tags: string;
  characters: string;
  creatorName: string;
  creatorUrl: string;
  isOriginal: boolean;
  targetMode: "create" | "update";
  targetWorkId: number | null;
  language: string;
  sourceName: string;
  sourceUrl: string;
  externalDownloadUrl: string;
};

type WorkLookupResult = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  aliases: string[];
  description: string | null;
  engineFamily: EngineFamily | "mixed" | "unknown" | "other";
  language: string;
  isOriginal: boolean;
  canEdit: boolean;
};

type CurrentUser = {
  email: string;
  displayName: string;
  roleKeys: string[];
  permissionKeys: string[];
};

type ImageSelections = {
  cover: File | null;
  browsingImages: File[];
};

type ImageHashes = {
  browsingImageBlobSha256s: string[];
};

type PreparedImages = { hashes: ImageHashes; blobs: MetadataBlobUpload[] };

const defaultForm: FlatMetadata = {
  originalTitle: "",
  chineseTitle: "",
  aliasTitles: "",
  engineFamily: "rpg_maker_2000",
  description: "",
  tags: "",
  characters: "",
  creatorName: "",
  creatorUrl: "",
  isOriginal: false,
  targetMode: "create",
  targetWorkId: null,
  language: "zh-CN",
  sourceName: "",
  sourceUrl: "",
  externalDownloadUrl: "",
};

export function UploadClient({ currentUser }: { currentUser: CurrentUser }) {
  const { startUpload } = useUploadTasks();
  const router = useRouter();
  const [mode, setMode] = useState<FileInputMode>("folder");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [form, setForm] = useState<FlatMetadata>(defaultForm);
  const [imageSelections, setImageSelections] = useState<ImageSelections>({
    cover: null,
    browsingImages: [],
  });
  const [lookupState, setLookupState] = useState<{
    loading: boolean;
    results: WorkLookupResult[];
    selectedWorkId: number | null;
  }>({
    loading: false,
    results: [],
    selectedWorkId: null,
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const canUploadFiles =
    form.engineFamily === "rpg_maker_2000" ||
    form.engineFamily === "rpg_maker_2003" ||
    form.engineFamily === "rpg_maker_2003_maniac";

  const selectedSourceSize = selectedFiles.reduce(
    (sum, file) => sum + file.size,
    0,
  );
  const selectedWork =
    lookupState.results.find(
      (work) => work.id === lookupState.selectedWorkId,
    ) ?? null;

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
    const files = Array.from(event.target.files ?? []);
    setSelectedFiles(files);
    if (!form.originalTitle.trim()) {
      const inferred = inferTitleFromFiles(files, mode);
      if (inferred) {
        setForm((current) => ({ ...current, originalTitle: inferred }));
      }
    }
  }

  function onOriginalTitleChange(value: string) {
    setLookupState((current) => ({
      ...current,
      selectedWorkId: null,
    }));
    setForm((current) => ({
      ...current,
      originalTitle: value,
      targetMode: "create",
      targetWorkId: null,
    }));
  }

  function applyExistingWork(work: WorkLookupResult) {
    const engineFamily = work.engineFamily;
    const originalTitle = work.originalTitle;

    setLookupState((current) => ({
      ...current,
      selectedWorkId: work.id,
    }));
    setForm((current) => ({
      ...current,
      originalTitle,
      chineseTitle: work.chineseTitle ?? "",
      aliasTitles: work.aliases.join("\n"),
      engineFamily,
      description: work.description ?? "",
      language: work.language || "zh-CN",
      isOriginal: work.isOriginal,
      targetMode: "update",
      targetWorkId: work.id,
    }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (!canUploadFiles) {
      if (selectedWork || form.targetMode !== "create") {
        setSubmitError("已有本站归档的游戏不能切换为外部下载模式，请创建新的外链作品。");
        return;
      }
      if (!form.originalTitle.trim()) {
        setSubmitError("请填写作品原名。");
        return;
      }
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

    if (selectedFiles.length === 0) {
      setSubmitError("请先选择游戏目录或 ZIP。");
      return;
    }

    if (!form.originalTitle.trim()) {
      setSubmitError("请填写作品原名。");
      return;
    }

    if (!selectedWork && !imageSelections.cover) {
      setSubmitError("新建游戏必须选择封面图。");
      return;
    }
    if (selectedWork && !imageSelections.cover && imageSelections.browsingImages.length) {
      setSubmitError("更新游戏时，选择浏览图也需要同时选择封面图。");
      return;
    }

    if (form.targetMode === "update" && !form.targetWorkId) {
      setSubmitError("请选择一个你有权限更新的已有游戏，或切换为创建新游戏。");
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
          <SectionHeading
            eyebrow="上传来源"
            title={canUploadFiles ? "游戏文件" : "外部下载"}
          />
          {canUploadFiles ? <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="源类型"
          >
            <Button
              className={
                mode === "folder"
                  ? "text-primary underline decoration-2 underline-offset-4"
                  : ""
              }
              onClick={() => setMode("folder")}
              type="button"
            >
              文件夹
            </Button>
            <Button
              className={
                mode === "zip"
                  ? "text-primary underline decoration-2 underline-offset-4"
                  : ""
              }
              onClick={() => setMode("zip")}
              type="button"
            >
              本地 ZIP
            </Button>
          </div> : null}

          {!canUploadFiles ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              站点不支持上传非 RPG Maker 2000/2003 系游戏，请提供可供下载的外部链接。
            </p>
          ) : mode === "folder" ? (
            <FilePicker
              accept=""
              directory
              label="选择游戏目录"
              multiple
              onChange={onSourceFileChange}
            />
          ) : (
            <FilePicker
              accept=".zip,application/zip"
              label="选择本地 ZIP"
              onChange={onSourceFileChange}
            />
          )}

          {canUploadFiles ? (
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
                disabled={Boolean(selectedWork)}
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
                  { value: "rpg_maker_2003_maniac", label: "RPG Maker 2003 Maniac" },
                  { value: "rpg_maker_xp", label: "RPG Maker XP" },
                  { value: "rpg_maker_vx", label: "RPG Maker VX" },
                  { value: "rpg_maker_vx_ace", label: "RPG Maker VX Ace" },
                  { value: "rpg_maker_mv", label: "RPG Maker MV" },
                  { value: "rpg_maker_mz", label: "RPG Maker MZ" },
                  { value: "rpg_maker_unite", label: "RPG Maker Unite" },
                  { value: "mixed", label: "混合引擎" },
                  { value: "unknown", label: "未知" },
                  { value: "other", label: "其他引擎" },
                ]}
                required
                value={form.engineFamily}
              />
            </FormField>
            <TextField
              form={form}
              label="中文名"
              name="chineseTitle"
              setForm={setForm}
            />
          </div>

          {lookupState.loading ? (
            <p className="text-sm text-muted">正在查找同名作品…</p>
          ) : null}
          {lookupState.results.length > 0 && !selectedWork && canUploadFiles ? (
            <div className="grid gap-3 rounded-lg border border-border bg-card p-4">
              <strong>资料库中可能已有同名作品</strong>
              {lookupState.results.map((work) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0"
                  key={work.id}
                >
                  <span>{work.originalTitle}</span>
                  {work.canEdit ? (
                    <Button
                      onClick={() => applyExistingWork(work)}
                      type="button"
                    >
                      更新此游戏
                    </Button>
                  ) : (
                    <span className="text-sm text-muted">
                      无更新权限，可创建独立游戏条目
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {selectedWork ? (
            <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-800 text-sm">
              将更新已有游戏：{selectedWork.originalTitle}
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <ImageField
              label="封面图"
              required={!selectedWork}
              onChange={(file) =>
                setImageSelections((current) => ({
                  ...current,
                  cover: file,
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
              <TextAreaField
                form={form}
                label="别名"
                name="aliasTitles"
                setForm={setForm}
              />
              <TextField
                form={form}
                label="标签"
                name="tags"
                setForm={setForm}
              />
              <TextAreaField
                form={form}
                label="登场角色"
                name="characters"
                setForm={setForm}
              />
              <TextField
                form={form}
                label="作者名"
                name="creatorName"
                setForm={setForm}
              />
              <TextField
                form={form}
                label="作者链接"
                name="creatorUrl"
                setForm={setForm}
              />
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
          <SectionHeading
            eyebrow="第二步"
            title={canUploadFiles ? "归档资料" : "外部下载"}
          />
          {canUploadFiles ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="提交方式">
                  <SelectField
                    onValueChange={(value) => {
                      const targetMode = value as "create" | "update";
                      if (targetMode === "create") {
                        setLookupState((current) => ({
                          ...current,
                          selectedWorkId: null,
                        }));
                      }
                      setForm((current) => ({
                        ...current,
                        targetMode,
                        targetWorkId:
                          targetMode === "create" ? null : current.targetWorkId,
                      }));
                    }}
                    options={[
                      { value: "create", label: "创建新游戏条目" },
                      { value: "update", label: "更新自己已有的游戏" },
                    ]}
                    value={form.targetMode}
                  />
                </FormField>
                <div className="bg-muted/10">
                  <FormField label="上传者">
                    <Input
                      readOnly
                      value={
                        currentUser?.displayName ||
                        currentUser?.email ||
                        "当前登录账户"
                      }
                    />
                  </FormField>
                </div>
              </div>
              <details className="grid gap-2">
                <summary>来源与运行信息</summary>
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    form={form}
                    label="来源名"
                    name="sourceName"
                    setForm={setForm}
                  />
                  <TextField
                    form={form}
                    label="来源链接"
                    name="sourceUrl"
                    setForm={setForm}
                  />
                </div>
              </details>
            </>
          ) : (
            <FormField
              hint="该地址将作为唯一下载入口，访问时会跳转到外部网站。"
              label="外部下载地址 *"
            >
              <Input
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    externalDownloadUrl: event.target.value,
                  }))
                }
                required
                type="url"
                value={form.externalDownloadUrl}
              />
            </FormField>
          )}
        </Pane>

        <Pane>
          <SectionHeading eyebrow="第三步" title="文件版本" />
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="游戏语言 *">
              <LanguageField
                onValueChange={(language) =>
                  setForm((current) => ({ ...current, language }))
                }
                value={form.language}
              />
            </FormField>
            <FormField label="作品属性">
              <Label className="flex min-h-10 items-center gap-2">
                <Checkbox
                  checked={form.isOriginal}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      isOriginal: checked === true,
                    }))
                  }
                />
                本站原创
              </Label>
            </FormField>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {submitError ? (
              <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 text-sm">
                {submitError}
              </p>
            ) : null}
            <Button
              disabled={
                preparing || (!canUploadFiles && !form.externalDownloadUrl.trim())
              }
              type="submit"
            >
              {preparing
                ? "正在准备…"
                : canUploadFiles
                  ? "开始导入"
                  : "发布外链作品"}
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
        onChange={(event) =>
          setForm((current) => ({ ...current, [name]: event.target.value }))
        }
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
        onChange={(event) =>
          setForm((current) => ({ ...current, [name]: event.target.value }))
        }
        rows={3}
        value={String(form[name])}
      />
    </FormField>
  );
}

function ImageField({
  label,
  required = false,
  onChange,
}: {
  label: string;
  required?: boolean;
  onChange: (file: File | null) => void;
}) {
  return (
    <FormField label={label}>
      <FilePicker
        accept="image/*"
        label={`选择${label}`}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        required={required}
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
  required = false,
}: {
  accept: string;
  directory?: boolean;
  label: string;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
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
        required={required}
        type="file"
        {...(directory ? { webkitdirectory: "", directory: "" } : {})}
      />
    </div>
  );
}

function buildMetadata(
  form: FlatMetadata,
  imageHashes: ImageHashes,
): ArchiveCommitMetadata {
  const originalTitle = form.originalTitle.trim();
  const optionalWorkText = (value: string): string | null =>
    form.targetMode === "update" ? value.trim() : cleanNullable(value);
  const creator =
    form.creatorName.trim()
      ? [
          {
            name: form.creatorName.trim(),
            originalName: null,
            websiteUrl: cleanNullable(form.creatorUrl),
            extra: {},
          },
        ]
      : [];
  return {
    game: {
      originalTitle,
      chineseTitle: optionalWorkText(form.chineseTitle),
      description: optionalWorkText(form.description),
      originalReleaseDate: null,
      originalReleasePrecision: "unknown",
      engineFamily: form.engineFamily,
      isOriginal: form.isOriginal,
      language: form.language,
      browsingImageBlobSha256s: imageHashes.browsingImageBlobSha256s,
      status: "published",
      extra: {},
    },
    target: {
      mode: form.targetMode,
      workId: form.targetWorkId,
    },
    archiveVersion: {
      sourceName: cleanNullable(form.sourceName),
      sourceUrl: cleanNullable(form.sourceUrl),
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
            creatorName: creator[0].name,
            roleKey: "author",
            roleLabel: "作者",
            notes: null,
          },
        ]
      : [],
    tags: form.tags
      .split(/[,，\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    externalLinks: {
      work: [],
    },
  };
}

async function submitExternalWork(
  form: FlatMetadata,
  images: ImageSelections,
): Promise<{ workId: number }> {
  const cover = images.cover;
  if (!cover) throw new Error("外链作品必须提供封面图。");
  const body = new FormData();
  body.set(
    "metadata",
    JSON.stringify({
      originalTitle: form.originalTitle.trim(),
      chineseTitle: cleanNullable(form.chineseTitle),
      description: cleanNullable(form.description),
      engineFamily: form.engineFamily,
      isOriginal: form.isOriginal,
      language: form.language,
      aliases: parseAliases(form.aliasTitles),
      tags: form.tags
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      characters: form.characters
        .split(/[,，\n]/)
        .map((character) => character.trim())
        .filter(Boolean),
      creatorName: cleanNullable(form.creatorName),
      creatorUrl: cleanNullable(form.creatorUrl),
    }),
  );
  body.set("download_url", form.externalDownloadUrl.trim());
  body.set("cover", cover);
  for (const image of images.browsingImages) {
    body.append("browsing_images[]", image);
  }
  const response = await fetch("/api/works/external", {
    method: "POST",
    body,
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok: true; workId: number }
    | { ok: false; detail?: string; error?: string }
    | null;
  if (!response.ok || !payload || !payload.ok) {
    throw new Error(
      payload && "detail" in payload
        ? payload.detail || payload.error || "发布外链作品失败。"
        : "发布外链作品失败。",
    );
  }
  return { workId: payload.workId };
}

async function prepareSelectedImages(
  input: ImageSelections,
): Promise<PreparedImages> {
  const blobs: MetadataBlobUpload[] = [];
  const browsingImageBlobSha256s: string[] = [];

  if (input.cover) {
    browsingImageBlobSha256s.push(
      await prepareMetadataImage(input.cover, blobs),
    );
  }

  for (const file of input.browsingImages) {
    browsingImageBlobSha256s.push(await prepareMetadataImage(file, blobs));
  }

  return {
    hashes: { browsingImageBlobSha256s },
    blobs: [...new Map(blobs.map((blob) => [blob.sha256, blob])).values()],
  };
}

async function prepareMetadataImage(
  file: File,
  blobs: MetadataBlobUpload[],
): Promise<string> {
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

  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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

function parseCharacterLines(
  value: string,
): NonNullable<ArchiveCommitMetadata["characters"]> {
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

function inferTitleFromFiles(
  files: File[],
  sourceKind: FileInputMode,
): string {
  const first = files[0];
  if (!first) return "";
  if (sourceKind === "zip") {
    return first.name.replace(/\.zip$/i, "");
  }
  const relativePath = (first as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  return relativePath?.split("/")[0] || first.name;
}
