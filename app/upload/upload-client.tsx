"use client";

import {
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import { FILE_POLICY_VERSION, PACKER_VERSION } from "@/lib/archive/file-policy";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import { useUploadTasks } from "@/app/upload/upload-task-provider";

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
  id: number;
  email: string;
  displayName: string;
  role: string;
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

export function UploadClient() {
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
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const recoverableTasks = useMemo(
    () =>
      tasks.filter((task) =>
        ["needs_source_reselect", "failed_recoverable", "paused"].includes(task.status),
      ),
    [tasks],
  );
  const selectedSourceSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const selectedWork =
    lookupState.results.find((work) => work.id === lookupState.selectedWorkId) ?? null;
  const releaseOptions = selectedWork?.releases ?? [];

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (response) =>
        response.ok ? ((await response.json()) as { ok: true; user: CurrentUser }) : null,
      )
      .then((body) => {
        if (body?.ok) {
          setCurrentUser(body.user);
        }
      })
      .catch(() => undefined);
  }, []);

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
            ? ((await response.json()) as { ok: true; works: WorkLookupResult[] })
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
          setLookupState((current) => ({ ...current, loading: false, results: [] }));
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
    const engineFamily =
      work.engineFamily === "rpg_maker_2003" ? "rpg_maker_2003" : "rpg_maker_2000";
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
      setSubmitError("请填写版本标识。");
      return;
    }

    if (!form.language.trim()) {
      setSubmitError("请填写归档语言。");
      return;
    }

    if (!form.archiveVariantLabel.trim()) {
      setSubmitError("请填写归档标识。");
      return;
    }

    setPreparing(true);

    try {
      const imageHashes = await uploadSelectedImages(imageSelections);
      const metadata = buildMetadata(form, imageHashes);

      startUpload({
        sourceKind: mode,
        files: selectedFiles,
        metadata,
        resumeLocalTaskId: resumeLocalTaskId || null,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "准备上传失败。");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="upload-layout">
      <section className="card upload-source-card">
        <h2>源文件</h2>
        <p>
          当前策略：<span className="mono">{FILE_POLICY_VERSION}</span> /{" "}
          <span className="mono">{PACKER_VERSION}</span>
        </p>
        <div className="segmented-control" role="tablist" aria-label="源类型">
          <button
            className={mode === "folder" ? "active" : ""}
            onClick={() => setMode("folder")}
            type="button"
          >
            文件夹
          </button>
          <button
            className={mode === "zip" ? "active" : ""}
            onClick={() => setMode("zip")}
            type="button"
          >
            本地 ZIP
          </button>
        </div>

        {mode === "folder" ? (
          <label className="file-drop">
            <span>选择游戏目录</span>
            <input
              multiple
              onChange={onSourceFileChange}
              type="file"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            />
          </label>
        ) : (
          <label className="file-drop">
            <span>选择本地 ZIP</span>
            <input accept=".zip,application/zip" onChange={onSourceFileChange} type="file" />
          </label>
        )}

        <dl className="upload-source-summary">
          <div>
            <dt>已选择</dt>
            <dd>{selectedFiles.length.toLocaleString("zh-CN")} 个文件</dd>
          </div>
          <div>
            <dt>源大小</dt>
            <dd>{formatBytes(selectedSourceSize)}</dd>
          </div>
        </dl>

        {recoverableTasks.length > 0 ? (
          <label className="field">
            <span>恢复任务</span>
            <select
              onChange={(event) => setResumeLocalTaskId(event.target.value)}
              value={resumeLocalTaskId}
            >
              <option value="">作为新任务导入</option>
              {recoverableTasks.map((task) => (
                <option key={task.localTaskId} value={task.localTaskId}>
                  恢复 {task.sourceName} / {Math.round(task.progress.percent)}%
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <form className="upload-form-stack" onSubmit={onSubmit}>
        <section className="card upload-form-card">
          <header className="upload-section-header">
            <div>
              <p className="eyebrow">Work</p>
              <h2>作品</h2>
            </div>
            <span>2 个必填项</span>
          </header>

          <div className="upload-form-grid">
            <label className="field">
              <span>原名 *</span>
              <input
                onChange={(event) => onOriginalTitleChange(event.target.value)}
                required
                type="text"
                value={form.originalTitle}
              />
            </label>
            <label className="field">
              <span>游戏引擎 *</span>
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    engineFamily: event.target.value as EngineFamily,
                  }))
                }
                required
                value={form.engineFamily}
              >
                <option value="rpg_maker_2000">RPG Maker 2000</option>
                <option value="rpg_maker_2003">RPG Maker 2003</option>
              </select>
            </label>
            <TextField
              form={form}
              label="中文名"
              name="chineseTitle"
              setForm={setForm}
            />
            <label className="field readonly-field">
              <span>自动 slug</span>
              <input readOnly type="text" value={form.workSlug} />
            </label>
          </div>

          {lookupState.loading ? <p className="muted-line">正在检测库内作品...</p> : null}
          {lookupState.results.length > 0 && !selectedWork ? (
            <div className="lookup-panel">
              <strong>库内可能已有同名作品</strong>
              {lookupState.results.map((work) => (
                <div className="lookup-row" key={work.id}>
                  <div>
                    <span>{work.originalTitle}</span>
                    <small>{work.slug}</small>
                  </div>
                  <button onClick={() => applyExistingWork(work)} type="button">
                    是，同一作品
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {selectedWork ? (
            <p className="success-message compact">
              已关联库内作品：{selectedWork.originalTitle}
            </p>
          ) : null}

          <div className="checkbox-grid">
            <label>
              <input
                checked={form.usesManiacsPatch}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    usesManiacsPatch: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Maniacs Patch
            </label>
          </div>

          <div className="upload-form-grid media-grid">
            <ImageField
              label="图标"
              onChange={(file) =>
                setImageSelections((current) => ({ ...current, icon: file }))
              }
            />
            <ImageField
              label="缩略图"
              onChange={(file) =>
                setImageSelections((current) => ({ ...current, thumbnail: file }))
              }
            />
            <label className="field wide-field">
              <span>浏览图</span>
              <input
                accept="image/*"
                multiple
                onChange={(event) =>
                  setImageSelections((current) => ({
                    ...current,
                    browsingImages: Array.from(event.target.files ?? []),
                  }))
                }
                type="file"
              />
            </label>
          </div>

          <details className="upload-details">
            <summary>更多作品信息</summary>
            <div className="upload-form-grid">
              <TextField form={form} label="排序标题" name="sortTitle" setForm={setForm} />
              <TextAreaField form={form} label="别名" name="aliasTitles" setForm={setForm} />
              <TextField form={form} label="标签文本" name="tags" setForm={setForm} />
              <TextAreaField
                form={form}
                label="登场角色"
                name="characters"
                setForm={setForm}
              />
              <TextField form={form} label="作者名" name="creatorName" setForm={setForm} />
              <TextField form={form} label="作者链接" name="creatorUrl" setForm={setForm} />
            </div>
            <label className="field">
              <span>简介</span>
              <textarea
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                rows={4}
                value={form.description}
              />
            </label>
          </details>
        </section>

        <section className="card upload-form-card">
          <header className="upload-section-header">
            <div>
              <p className="eyebrow">Release</p>
              <h2>发布版本</h2>
            </div>
            <span>3 个必填项</span>
          </header>

          {releaseOptions.length > 0 ? (
            <label className="field">
              <span>使用已有 Release</span>
              <select
                onChange={(event) => applyExistingRelease(event.target.value)}
                value={lookupState.selectedReleaseId ? String(lookupState.selectedReleaseId) : ""}
              >
                <option value="">创建新的 Release</option>
                {releaseOptions.map((release) => (
                  <option key={release.id} value={release.id}>
                    {release.label} / {release.key}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="upload-form-grid">
            <label className="field">
              <span>基底版本 *</span>
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    baseVariant: event.target.value as ReleaseBaseVariant,
                  }))
                }
                required
                value={form.baseVariant}
              >
                {baseVariantOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>发布类型 *</span>
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    releaseType: event.target.value as ReleaseType,
                  }))
                }
                required
                value={form.releaseType}
              >
                {releaseTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>版本标识 *</span>
              <input
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    variantLabel: event.target.value,
                  }))
                }
                placeholder="A方案、B方案、官方、默认版等"
                required
                type="text"
                value={form.variantLabel}
              />
            </label>
            <label className="field">
              <span>发布日期</span>
              <input
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    releaseDate: event.target.value,
                  }))
                }
                type="date"
                value={form.releaseDate}
              />
            </label>
            <label className="field readonly-field">
              <span>上传者</span>
              <input
                readOnly
                type="text"
                value={currentUser?.displayName || currentUser?.email || "当前登录账户"}
              />
            </label>
            <label className="field readonly-field">
              <span>自动 Release 标签</span>
              <input readOnly type="text" value={buildReleaseLabel(form)} />
            </label>
            <label className="field readonly-field wide-field">
              <span>稳定 Release Key</span>
              <input readOnly type="text" value={buildReleaseKey(form)} />
            </label>
          </div>

          <details className="upload-details">
            <summary>更多发布信息</summary>
            <div className="upload-form-grid">
              <TextField form={form} label="来源名" name="sourceName" setForm={setForm} />
              <TextField form={form} label="来源链接" name="sourceUrl" setForm={setForm} />
              <TextField form={form} label="可执行入口" name="executablePath" setForm={setForm} />
            </div>
            <label className="field">
              <span>版权/授权备注</span>
              <textarea
                onChange={(event) =>
                  setForm((current) => ({ ...current, rightsNotes: event.target.value }))
                }
                rows={3}
                value={form.rightsNotes}
              />
            </label>
          </details>
        </section>

        <section className="card upload-form-card">
          <header className="upload-section-header">
            <div>
              <p className="eyebrow">ArchiveVersion</p>
              <h2>归档快照</h2>
            </div>
            <span>2 个必填项</span>
          </header>
          <div className="upload-form-grid">
            <label className="field">
              <span>归档语言 *</span>
              <input
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
            </label>
            <label className="field">
              <span>归档标识 *</span>
              <input
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    archiveVariantLabel: event.target.value,
                  }))
                }
                placeholder="默认版、A方案、B方案等"
                required
                type="text"
                value={form.archiveVariantLabel}
              />
            </label>
            <label className="field readonly-field">
              <span>自动归档标签</span>
              <input readOnly type="text" value={buildArchiveVersionLabel(form)} />
            </label>
            <label className="field readonly-field wide-field">
              <span>稳定 Archive Key</span>
              <input readOnly type="text" value={buildArchiveVersionKey(form)} />
            </label>
          </div>
          <div className="checkbox-grid">
            <label>
              <input
                checked={form.isProofread}
                onChange={(event) =>
                  setForm((current) => ({ ...current, isProofread: event.target.checked }))
                }
                type="checkbox"
              />
              已校对
            </label>
            <label>
              <input
                checked={form.isImageEdited}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isImageEdited: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              已修图
            </label>
          </div>
          <dl className="upload-source-summary">
            <div>
              <dt>策略</dt>
              <dd>{FILE_POLICY_VERSION}</dd>
            </div>
            <div>
              <dt>打包器</dt>
              <dd>{PACKER_VERSION}</dd>
            </div>
          </dl>
          <p className="muted-line">
            文件数、大小、manifest、core pack、排除项和 ArchiveVersion 标签会在导入任务中自动生成。
          </p>

          {submitError ? <p className="error-message compact">{submitError}</p> : null}
          <div className="actions">
            <button className="button primary" disabled={preparing} type="submit">
              {preparing ? "准备中..." : "开始导入"}
            </button>
          </div>
        </section>
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
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        onChange={(event) =>
          setForm((current) => ({ ...current, [name]: event.target.value }))
        }
        type="text"
        value={String(form[name])}
      />
    </label>
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
    <label className="field">
      <span>{label}</span>
      <textarea
        name={name}
        onChange={(event) =>
          setForm((current) => ({ ...current, [name]: event.target.value }))
        }
        rows={3}
        value={String(form[name])}
      />
    </label>
  );
}

function ImageField({
  label,
  onChange,
}: {
  label: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        accept="image/*"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        type="file"
      />
    </label>
  );
}

function buildMetadata(form: FlatMetadata, imageHashes: ImageHashes): ArchiveCommitMetadata {
  const originalTitle = form.originalTitle.trim();
  const chineseTitle = form.chineseTitle.trim();
  const creatorSlug =
    form.creatorSlug.trim() || (form.creatorName.trim() ? slugFromTitle(form.creatorName) : "");
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
  const archiveVersionLabel = `${buildArchiveVersionLabel(form)}・browser-${timestampLabel()}`;
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
      engineDetail:
        form.engineFamily === "rpg_maker_2003" ? "RPG Maker 2003" : "RPG Maker 2000",
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

async function uploadSelectedImages(input: ImageSelections): Promise<ImageHashes> {
  const iconBlobSha256 = input.icon ? await uploadMetadataImage(input.icon) : null;
  const thumbnailBlobSha256 = input.thumbnail
    ? await uploadMetadataImage(input.thumbnail)
    : null;
  const browsingImageBlobSha256s: string[] = [];

  for (const file of input.browsingImages) {
    browsingImageBlobSha256s.push(await uploadMetadataImage(file));
  }

  return {
    iconBlobSha256,
    thumbnailBlobSha256,
    browsingImageBlobSha256s,
  };
}

async function uploadMetadataImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} 不是图片文件。`);
  }

  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const response = await fetch(`/api/blobs/${sha256}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "content-type": file.type || "application/octet-stream",
    },
    body: bytes,
  });

  if (!response.ok) {
    throw new Error(`图片上传失败：${file.name}`);
  }

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
  return [
    baseVariantDisplay(form.baseVariant),
    releaseTypeShortDisplay(form.releaseType),
    form.variantLabel.trim(),
  ]
    .filter(Boolean)
    .join("・");
}

function buildReleaseKey(form: FlatMetadata): string {
  return [
    form.baseVariant,
    form.releaseType,
    keyPart(form.variantLabel),
  ].join(".");
}

function buildArchiveVersionLabel(form: FlatMetadata): string {
  return [
    languageDisplay(form.language),
    archiveQualityDisplay(form),
    form.archiveVariantLabel.trim(),
  ]
    .filter(Boolean)
    .join("・");
}

function buildArchiveVersionKey(form: FlatMetadata): string {
  return [
    keyPart(form.language),
    archiveQualityKey(form),
    keyPart(form.archiveVariantLabel),
  ].join(".");
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

function localDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function timestampLabel(): string {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];

  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}

function formatBytes(value: number): string {
  let next = value;

  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (next < 1024 || unit === "GB") {
      return unit === "B" ? `${next} B` : `${next.toFixed(2)} ${unit}`;
    }

    next /= 1024;
  }

  return `${value} B`;
}
