"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type RefObject,
  type SetStateAction,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  FileArchive,
  FolderOpen,
  Link as LinkIcon,
  LoaderCircle,
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
import { CharacterPicker } from "@/app/upload/character-picker";
import { inspectUploadSource } from "@/app/upload/archive-source";
import {
  CoverPicker,
  PreviewPicker,
} from "@/app/upload/media-picker";
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
import {
  readTranslationPreference,
  updateTranslationPreference,
} from "@/app/upload/translation-preference";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import type {
  CharacterCreditSelection,
  CharacterSelection,
  CharacterSuggestion,
} from "@/lib/character-names";
import { characterSelectionKey } from "@/lib/character-names";
import { normalizeArchivePath } from "@/lib/archive/file-policy";
import { formatBytes, formatDate } from "@/lib/format";
import { isArchiveEngineFamily } from "@/lib/labels";
import {
  ORIGINAL_RELEASE_DATE_FORMAT_ERROR,
  parseOriginalReleaseDate,
} from "@/lib/original-release-date";
import { cn } from "@/lib/ui/cn";

type EngineFamily = ArchiveCommitMetadata["game"]["engineFamily"];
type CharacterCredit = NonNullable<ArchiveCommitMetadata["characters"]>[number];
type CreatorCredit = ArchiveCommitMetadata["creators"][number];
type WorkStaffCredit = ArchiveCommitMetadata["workStaff"][number];
export type UploadStaffCredit = {
  creator: CreatorCredit;
  staff: WorkStaffCredit;
};
type AssociationDefaults = {
  characters: CharacterCredit[];
  authors: UploadStaffCredit[];
  translators: UploadStaffCredit[];
};
type FlatMetadata = {
  originalTitle: string;
  chineseTitle: string;
  aliasTitles: string[];
  engineFamily: EngineFamily;
  description: string;
  tags: string[];
  characters: CharacterCreditSelection[];
  creatorName: string;
  translatorName: string;
  originalReleaseDate: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  sourceUrl: string;
  externalDownloadUrl: string;
  status: "published" | "hidden";
};

type CurrentUser = {
  id: number;
  displayName: string;
  permissionKeys: string[];
};

export type UploadInitialWork = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  aliases: string[];
  description: string | null;
  originalReleaseDate: string | null;
  engineFamily: "rpg_maker_2000" | "rpg_maker_2003" | "rpg_maker_2003_maniac";
  language: string;
  isOriginal: boolean;
  isTranslation: boolean;
  status: "published" | "hidden";
  tags: string[];
  characterCredits: CharacterCredit[];
  authorCredits: UploadStaffCredit[];
  translatorCredits: UploadStaffCredit[];
  previewBlobSha256s: string[];
};

type ImageSelections = { cover: File | null; browsingImages: File[] };
type PreparedImages = {
  hashes: { browsingImageBlobSha256s: string[] };
  blobs: MetadataBlobUpload[];
};
type CharacterPortraitFiles = Record<string, File>;
type PreparedCharacterPortraits = {
  hashesBySelectionKey: Record<string, string>;
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
    characters: CharacterSuggestion[];
  };
}) {
  const router = useRouter();
  const upload = useUploadController(currentUser.id);
  const canArchiveUpload = currentUser.permissionKeys.includes("import_job.create");
  const [mode, setMode] = useState<UploadSourceKind>("folder");
  const [form, setForm] = useState<FlatMetadata>(() =>
    initialForm(initialWork, canArchiveUpload, currentUser.displayName),
  );
  const [associationDefaults, setAssociationDefaults] = useState<AssociationDefaults>(
    () => initialAssociations(initialWork),
  );
  const [imageSelections, setImageSelections] = useState<ImageSelections>({
    cover: null,
    browsingImages: [],
  });
  const [characterPortraitFiles, setCharacterPortraitFiles] =
    useState<CharacterPortraitFiles>({});
  const [sourceCoverCandidates, setSourceCoverCandidates] = useState<File[]>([]);
  const sourceInspectionGenerationRef = useRef(0);
  const automaticCoverRef = useRef<File | null>(null);
  const [sourceSummary, setSourceSummary] = useState<{
    name: string;
    fileCount: number;
    sizeBytes: number;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [translatorError, setTranslatorError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const coverCandidates = useMemo(
    () => [...sourceCoverCandidates, ...imageSelections.browsingImages],
    [imageSelections.browsingImages, sourceCoverCandidates],
  );
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

  useEffect(() => {
    if (initialWork) return;
    const timeoutId = window.setTimeout(() => {
      const preference = readTranslationPreference(currentUser.id);
      if (!preference) return;
      setForm((current) => ({
        ...current,
        isOriginal: false,
        isTranslation: preference.isTranslation,
        translatorName: preference.translatorText ?? currentUser.displayName,
      }));
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [currentUser.displayName, currentUser.id, initialWork]);

  function changeOriginalDeclaration(checked: boolean) {
    setTranslatorError(null);
    setForm((current) => ({
      ...current,
      isOriginal: checked,
      isTranslation: checked ? false : current.isTranslation,
    }));
    if (checked) {
      updateTranslationPreference(currentUser.id, { isTranslation: false });
    }
  }

  function changeTranslationDeclaration(checked: boolean) {
    setTranslatorError(null);
    setForm((current) => ({
      ...current,
      isOriginal: checked ? false : current.isOriginal,
      isTranslation: checked,
    }));
    updateTranslationPreference(currentUser.id, { isTranslation: checked });
  }

  function changeTranslatorName(value: string) {
    setTranslatorError(null);
    setForm((current) => ({ ...current, translatorName: value }));
    updateTranslationPreference(currentUser.id, {
      isTranslation: form.isTranslation,
      translatorText: value.trim() || null,
    });
  }

  function changeCharacters(characters: CharacterCreditSelection[]) {
    const keys = new Set(characters.map((credit) => characterSelectionKey(credit.selection)));
    setCharacterPortraitFiles((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => keys.has(key))),
    );
    setForm((current) => ({ ...current, characters }));
  }

  function changeCharacterPortraitFile(
    selection: CharacterSelection,
    file: File | null,
  ) {
    const key = characterSelectionKey(selection);
    setCharacterPortraitFiles((current) => {
      if (file) return { ...current, [key]: file };
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function prefillSourceMetadata(
    sourceKind: UploadSourceKind,
    files: UploadSourceFile[],
    canPrefillOriginalTitle: boolean,
    generation: number,
  ) {
    try {
      const prefill = await inspectUploadSource(files, sourceKind);
      if (generation !== sourceInspectionGenerationRef.current) return;
      setSourceCoverCandidates(prefill.titleImages);

      if (canPrefillOriginalTitle && prefill.gameTitle) {
        setForm((current) =>
          current.originalTitle.trim()
            ? current
            : { ...current, originalTitle: prefill.gameTitle ?? current.originalTitle },
        );
      }

      const latestTitleImage = prefill.titleImages[0];
      if (!latestTitleImage || initialWork?.previewBlobSha256s.length) return;

      if (generation !== sourceInspectionGenerationRef.current) return;
      setImageSelections((current) => {
        if (current.cover) return current;
        automaticCoverRef.current = latestTitleImage;
        return { ...current, cover: latestTitleImage };
      });
    } catch {
      // Source inspection only supplies defaults; the upload worker reports source errors.
    }
  }

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
    const canPrefillOriginalTitle = !form.originalTitle.trim();
    const generation = sourceInspectionGenerationRef.current + 1;
    sourceInspectionGenerationRef.current = generation;
    setSourceCoverCandidates([]);
    const previousAutomaticCover = automaticCoverRef.current;
    automaticCoverRef.current = null;
    if (previousAutomaticCover) {
      setImageSelections((current) =>
        current.cover === previousAutomaticCover ? { ...current, cover: null } : current,
      );
    }
    setMode(sourceKind);
    setSourceSummary({ name: sourceName, fileCount: files.length, sizeBytes });
    upload.startSource({
      sourceKind,
      sourceName,
      files,
      targetWorkId: initialWork?.id ?? null,
    });
    void prefillSourceMetadata(
      sourceKind,
      files,
      canPrefillOriginalTitle,
      generation,
    );
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
    setTranslatorError(null);
    if (form.isOriginal && form.isTranslation) {
      setSubmitError("原创声明与翻译声明不能同时选择。");
      return;
    }
    if (form.isTranslation && !form.translatorName.trim()) {
      setTranslatorError("请填写译者。");
      document.getElementById("upload-translator")?.focus();
      return;
    }
    if (!form.originalTitle.trim()) {
      setSubmitError("请填写作品原名。");
      return;
    }
    if (!parseOriginalReleaseDate(form.originalReleaseDate)) {
      setSubmitError(ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
      document.getElementById("upload-release-date")?.focus();
      return;
    }
    const characterWithoutPortrait = form.characters.find((credit) => {
      const selection = credit.selection;
      if (credit.portrait || characterPortraitFiles[characterSelectionKey(selection)]) {
        return false;
      }
      return selection.kind === "new" || !suggestions.characters.find(
        (item) => item.id === selection.characterId,
      )?.defaultPortrait;
    });
    if (characterWithoutPortrait) {
      setSubmitError(
        `角色“${characterWithoutPortrait.selection.originalName}”还没有头像，请从素材表选择或上传 48×48 PNG。`,
      );
      document.getElementById("upload-characters")?.focus();
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
        const portraits = await prepareCharacterPortraits(characterPortraitFiles);
        const result = await submitExternalWork(
          form,
          imageSelections,
          portraits,
        );
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
      const portraits = await prepareCharacterPortraits(characterPortraitFiles);
      const images = imageSelections.cover
        ? await prepareSelectedImages(imageSelections)
        : {
            hashes: {
              browsingImageBlobSha256s: initialWork?.previewBlobSha256s ?? [],
            },
            blobs: [],
          };
      upload.confirmMetadata(
        buildMetadata(
          form,
          images.hashes,
          portraits.hashesBySelectionKey,
          initialWork?.id ?? null,
          associationDefaults,
        ),
        uniqueMetadataBlobs([...images.blobs, ...portraits.blobs]),
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "作品资料确认失败。");
    } finally {
      setPreparing(false);
    }
  }

  async function restore(draft: UploadRecoveryDraft) {
    if (!(await upload.restoreDraft(draft))) return;
    sourceInspectionGenerationRef.current += 1;
    automaticCoverRef.current = null;
    setSourceCoverCandidates([]);
    if (draft.metadata) {
      setForm(formFromMetadata(draft.metadata));
      setTranslatorError(null);
      setAssociationDefaults(associationsFromMetadata(draft.metadata));
      const filesByHash = new Map(
        draft.metadataBlobs.map((blob) => [blob.sha256, blob.file]),
      );
      const previewFiles = draft.metadata.game.browsingImageBlobSha256s
        .map((hash) => filesByHash.get(hash) ?? null)
        .filter((file): file is File => Boolean(file));
      setImageSelections({
        cover: previewFiles[0] ?? null,
        browsingImages: previewFiles.slice(1),
      });
      setCharacterPortraitFiles(
        Object.fromEntries(
          (draft.metadata.characters ?? []).flatMap((credit) => {
            const hash = credit.portrait?.blobSha256;
            const file = hash ? filesByHash.get(hash) : null;
            return file ? [[characterSelectionKey(credit.selection), file]] : [];
          }),
        ),
      );
    }
    setMode(draft.preparedSource.sourceKind);
    setSourceSummary({
      name: draft.preparedSource.sourceName,
      fileCount: draft.preparedSource.stats.sourceFileCount,
      sizeBytes: draft.preparedSource.stats.sourceSizeBytes,
    });
  }

  function restart() {
    sourceInspectionGenerationRef.current += 1;
    setSourceCoverCandidates([]);
    const previousAutomaticCover = automaticCoverRef.current;
    automaticCoverRef.current = null;
    if (previousAutomaticCover) {
      setImageSelections((current) =>
        current.cover === previousAutomaticCover ? { ...current, cover: null } : current,
      );
    }
    upload.resetTask();
    setSourceSummary(null);
    setSubmitError(null);
  }

  async function cancelUpload() {
    if (await upload.cancelTask()) restart();
  }

  return (
    <div className="grid gap-5" data-upload-phase={upload.task?.phase ?? "idle"}>
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
                      <Button
                        data-upload-action="resume-draft"
                        onClick={() => void restore(draft)}
                        size="sm"
                        type="button"
                      >
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
                    canceling={upload.canceling}
                    disabled={preparing || Boolean(sourceSummary) || upload.active}
                    mode={mode}
                    onCancel={() => void cancelUpload()}
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
                    characterPortraitFiles={characterPortraitFiles}
                    changeOriginalDeclaration={changeOriginalDeclaration}
                    changeCharacterPortraitFile={changeCharacterPortraitFile}
                    changeCharacters={changeCharacters}
                    changeTranslationDeclaration={changeTranslationDeclaration}
                    changeTranslatorName={changeTranslatorName}
                    disabled={preparing}
                    form={form}
                    imageSelections={imageSelections}
                    initialWork={initialWork}
                    setForm={setForm}
                    setImageSelections={setImageSelections}
                    suggestions={suggestions}
                    translatorError={translatorError}
                  />
                )}
              </section>
            </div>

            <aside className="min-w-0 border-t border-border bg-background/40 lg:border-l lg:border-t-0">
              <div className="lg:sticky lg:top-16">
                <div className="border-b border-border p-4">
                  <CoverPicker
                    candidateFiles={coverCandidates}
                    disabled={formDisabled}
                    existingBlobSha256s={initialWork?.previewBlobSha256s}
                    file={imageSelections.cover}
                    includeSelectedFileCandidate={
                      imageSelections.cover !== automaticCoverRef.current
                    }
                    onChange={(cover) => {
                      automaticCoverRef.current = null;
                      setImageSelections((current) => ({ ...current, cover }));
                    }}
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
  canceling,
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
  canceling: boolean;
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
  const dragDepthRef = useRef(0);
  const instructionsId = useId();
  const [fileDragActive, setFileDragActive] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  function openZipPicker() {
    if (!disabled) zipInputRef.current?.click();
  }

  function resetFileDrag() {
    dragDepthRef.current = 0;
    setFileDragActive(false);
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-bold">游戏文件</h2>
      {sourceSummary ? (
        <UploadTaskCard
          canceling={canceling}
          mode={mode}
          onCancel={onCancel}
          onRestart={onRestart}
          sourceSummary={sourceSummary}
          task={task}
        />
      ) : (
        <div
          aria-describedby={instructionsId}
          aria-disabled={disabled || undefined}
          aria-label={fileDragActive ? "松开以上传游戏文件" : "拖入游戏文件夹或 ZIP 压缩包"}
          className={cn(
            "grid min-h-52 place-items-center rounded-lg border-2 border-dashed border-border bg-background p-5 text-center transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:border-primary hover:bg-primary/5",
            fileDragActive && !disabled && "border-primary bg-primary/10 ring-2 ring-primary/20",
          )}
          data-file-drag-active={fileDragActive || undefined}
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("[data-upload-picker]")) return;
            openZipPicker();
          }}
          onDragEnter={(event) => {
            if (!hasDraggedFiles(event)) return;
            event.preventDefault();
            if (disabled) return;
            dragDepthRef.current += 1;
            setFileDragActive(true);
          }}
          onDragLeave={() => {
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setFileDragActive(false);
          }}
          onDragOver={(event) => {
            if (!hasDraggedFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = disabled ? "none" : "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const hasFiles = hasDraggedFiles(event);
            resetFileDrag();
            if (!disabled && hasFiles) void onDrop(event);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
              return;
            }
            event.preventDefault();
            openZipPicker();
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
        >
          <div className="grid justify-items-center gap-2">
            <Upload className="size-8 text-primary" />
            <strong aria-live="polite">
              {fileDragActive ? "松开以上传" : "拖入游戏文件夹或 ZIP 压缩包"}
            </strong>
            <span className="text-sm text-muted" id={instructionsId}>
              文件夹根目录或 ZIP 内须包含 RPG_RT.lmt
            </span>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <FilePicker
                accept=".zip,application/zip"
                disabled={disabled}
                inputRef={zipInputRef}
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
  characterPortraitFiles,
  changeCharacterPortraitFile,
  changeCharacters,
  changeOriginalDeclaration,
  changeTranslationDeclaration,
  changeTranslatorName,
  disabled,
  form,
  imageSelections,
  initialWork,
  setForm,
  setImageSelections,
  suggestions,
  translatorError,
}: {
  characterPortraitFiles: CharacterPortraitFiles;
  changeCharacterPortraitFile: (selection: CharacterSelection, file: File | null) => void;
  changeCharacters: (characters: CharacterCreditSelection[]) => void;
  changeOriginalDeclaration: (checked: boolean) => void;
  changeTranslationDeclaration: (checked: boolean) => void;
  changeTranslatorName: (value: string) => void;
  disabled: boolean;
  form: FlatMetadata;
  imageSelections: ImageSelections;
  initialWork: UploadInitialWork | null;
  setForm: Dispatch<SetStateAction<FlatMetadata>>;
  setImageSelections: Dispatch<SetStateAction<ImageSelections>>;
  suggestions: {
    tags: UploadTaxonomySuggestion[];
    characters: CharacterSuggestion[];
  };
  translatorError: string | null;
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
        <WorkbenchField controlId="upload-author" label="作者">
          <Input disabled={disabled} id="upload-author" onChange={(event) => setForm((current) => ({ ...current, creatorName: event.target.value }))} value={form.creatorName} />
        </WorkbenchField>
        {form.isTranslation ? (
          <WorkbenchField controlId="upload-translator" label="译者" required>
            <div className="grid gap-1.5">
              <Input
                aria-describedby={translatorError ? "upload-translator-error" : undefined}
                aria-invalid={translatorError ? true : undefined}
                disabled={disabled}
                id="upload-translator"
                onChange={(event) => changeTranslatorName(event.target.value)}
                required
                value={form.translatorName}
              />
              {translatorError ? (
                <p className="text-sm text-red-700" id="upload-translator-error" role="alert">
                  {translatorError}
                </p>
              ) : null}
            </div>
          </WorkbenchField>
        ) : null}
        <WorkbenchField
          className="md:col-span-2"
          controlId="upload-release-date"
          info="作品最初发表的日期"
          label="发布日期"
        >
          <Input
            disabled={disabled}
            id="upload-release-date"
            onChange={(event) => setForm((current) => ({ ...current, originalReleaseDate: event.target.value }))}
            value={form.originalReleaseDate}
          />
        </WorkbenchField>
        <WorkbenchField
          className="md:col-span-2"
          label={<span id="upload-declarations-label">发布声明</span>}
        >
          <div
            aria-labelledby="upload-declarations-label"
            className="flex flex-wrap gap-x-5 gap-y-3 py-2.5"
            role="group"
          >
            <Label className="flex w-fit items-center gap-2 text-sm text-red-700" htmlFor="upload-is-original">
              <Checkbox
                checked={form.isOriginal}
                className="data-[state=checked]:border-red-700 data-[state=checked]:bg-red-700"
                disabled={disabled}
                id="upload-is-original"
                onCheckedChange={(checked) => changeOriginalDeclaration(checked === true)}
              />
              本作品为我原创。
            </Label>
            <Label className="flex w-fit items-center gap-2 text-sm" htmlFor="upload-is-translation">
              <Checkbox
                checked={form.isTranslation}
                disabled={disabled}
                id="upload-is-translation"
                onCheckedChange={(checked) => changeTranslationDeclaration(checked === true)}
              />
              本作品为翻译作品。
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
          <CharacterPicker
            disabled={disabled}
            id="upload-characters"
            onChange={changeCharacters}
            onPortraitFileChange={changeCharacterPortraitFile}
            portraitFiles={characterPortraitFiles}
            suggestions={suggestions.characters}
            values={form.characters}
          />
        </WorkbenchField>
        <details className="md:col-span-2">
          <summary className="cursor-pointer py-1 text-sm font-bold">更多设置</summary>
          <div className="mt-3 grid gap-4 border-t border-border pt-4">
            <WorkbenchField label="预览图">
              <PreviewPicker disabled={disabled} existingCount={Math.max(0, (initialWork?.previewBlobSha256s.length ?? 0) - 1)} files={imageSelections.browsingImages} onChange={(browsingImages) => setImageSelections((current) => ({ ...current, browsingImages }))} />
            </WorkbenchField>
            <WorkbenchField controlId="upload-aliases" label="别名">
              <TokenPicker
                disabled={disabled}
                id="upload-aliases"
                onChange={(aliasTitles) => setForm((current) => ({ ...current, aliasTitles }))}
                placeholder="输入别名"
                showRecommendations={false}
                showSelectionCount={false}
                suggestions={[]}
                values={form.aliasTitles}
              />
            </WorkbenchField>
            <WorkbenchField controlId="upload-source-url" label="来源链接">
              <Input disabled={disabled} id="upload-source-url" onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))} type="url" value={form.sourceUrl} />
            </WorkbenchField>
          </div>
        </details>
      </div>
    </div>
  );
}

function UploadTaskCard({ canceling, mode, onCancel, onRestart, sourceSummary, task }: {
  canceling: boolean;
  mode: UploadSourceKind;
  onCancel: () => void;
  onRestart: () => void;
  sourceSummary: { name: string; fileCount: number; sizeBytes: number };
  task: BrowserUploadTaskSnapshot | null;
}) {
  const progress = Math.min(100, task?.progress.percent ?? 0);
  const progressLabel = task?.sourceReady
    ? "游戏文件已校验"
    : task
      ? phaseLabel(task.phase)
      : "准备上传";
  const canCancel = Boolean(task && ["running", "waiting"].includes(task.status) && task.phase !== "committing");
  const showCancel = canceling || canCancel;
  const canRestart = Boolean(!canceling && task && ["failed", "canceled"].includes(task.status));
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
        <Progress aria-label="游戏文件处理、上传与校验进度" className="mt-4" value={progress} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <strong>{progressLabel}</strong>
          {task?.progress.currentPath ? <span className="max-w-full truncate font-mono">{task.progress.currentPath}</span> : null}
        </div>
        {task?.error ? <p className="mt-3 border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{task.error}</p> : null}
        {task?.result ? <p className="mt-3 border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">上传完成。<Link className="font-semibold underline" href={`/games/${task.result.workId}`}>查看作品</Link></p> : null}
      </div>
      {showCancel || canRestart ? (
        <footer className="flex justify-end gap-2 border-t border-border bg-background/60 px-4 py-3">
          {showCancel ? (
            <Button
              aria-busy={canceling}
              disabled={canceling}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="outline"
            >
              {canceling ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
              {canceling ? "取消中" : "取消上传"}
            </Button>
          ) : null}
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

function initialForm(
  work: UploadInitialWork | null,
  canArchiveUpload: boolean,
  displayName: string,
): FlatMetadata {
  return {
    originalTitle: work?.originalTitle ?? "",
    chineseTitle: work?.chineseTitle ?? "",
    aliasTitles: uniqueTokens(work?.aliases ?? []),
    engineFamily: work?.engineFamily ?? (canArchiveUpload ? "rpg_maker_2000" : "other"),
    description: work?.description ?? "",
    tags: work?.tags ?? [],
    characters: work?.characterCredits.map(({ selection, portrait }) => ({ selection, portrait })) ?? [],
    creatorName: work?.authorCredits[0]?.creator.name ?? "",
    translatorName: work
      ? work.translatorCredits[0]?.creator.name ?? ""
      : displayName,
    originalReleaseDate: work?.originalReleaseDate ?? "",
    isOriginal: work?.isOriginal ?? false,
    isTranslation: work?.isTranslation ?? false,
    language: work?.language ?? "zh-CN",
    sourceUrl: "",
    externalDownloadUrl: "",
    status: work?.status ?? "published",
  };
}

function initialAssociations(work: UploadInitialWork | null): AssociationDefaults {
  return work
    ? {
        characters: work.characterCredits,
        authors: work.authorCredits,
        translators: work.translatorCredits,
      }
    : { characters: [], authors: [], translators: [] };
}

function associationsFromMetadata(metadata: ArchiveCommitMetadata): AssociationDefaults {
  const creators = new Map(metadata.creators.map((creator) => [entityNameKey(creator.name), creator]));
  return {
    characters: metadata.characters ?? [],
    authors: metadata.workStaff.filter((staff) => staff.roleKey === "author").map((staff) => ({
      creator: creators.get(entityNameKey(staff.creatorName)) ?? { name: staff.creatorName, originalName: null, websiteUrl: null, extra: {} },
      staff,
    })),
    translators: metadata.workStaff.filter((staff) => staff.roleKey === "translator").map((staff) => ({
      creator: creators.get(entityNameKey(staff.creatorName)) ?? { name: staff.creatorName, originalName: null, websiteUrl: null, extra: {} },
      staff,
    })),
  };
}

function formFromMetadata(metadata: ArchiveCommitMetadata): FlatMetadata {
  const authorNames = metadata.workStaff.filter((staff) => staff.roleKey === "author").map((staff) => staff.creatorName);
  const translatorNames = metadata.workStaff.filter((staff) => staff.roleKey === "translator").map((staff) => staff.creatorName);
  return {
    originalTitle: metadata.game.originalTitle,
    chineseTitle: metadata.game.chineseTitle ?? "",
    aliasTitles: uniqueTokens(metadata.workTitles.map((item) => item.title)),
    engineFamily: metadata.game.engineFamily,
    description: metadata.game.description ?? "",
    tags: metadata.tags,
    characters: (metadata.characters ?? []).map(({ selection, portrait }) => ({ selection, portrait })),
    creatorName: authorNames[0] ?? "",
    translatorName: translatorNames[0] ?? "",
    originalReleaseDate: metadata.game.originalReleaseDate ?? "",
    isOriginal: metadata.game.isOriginal,
    isTranslation: metadata.game.isTranslation,
    language: metadata.game.language,
    sourceUrl: metadata.archiveVersion.sourceUrl ?? "",
    externalDownloadUrl: "",
    status: metadata.game.status === "hidden" ? "hidden" : "published",
  };
}

function buildMetadata(
  form: FlatMetadata,
  imageHashes: { browsingImageBlobSha256s: string[] },
  portraitHashes: Record<string, string>,
  targetWorkId: number | null,
  defaults: AssociationDefaults,
): ArchiveCommitMetadata {
  const releaseDate = parseOriginalReleaseDate(form.originalReleaseDate);
  if (!releaseDate) throw new Error(ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
  const characterDefaults = new Map(defaults.characters.map((character) => [characterSelectionKey(character.selection), character]));
  const characters = uniqueCharacterSelections(form.characters).map((credit, index) => {
    const selection = credit.selection;
    const existing = characterDefaults.get(characterSelectionKey(selection));
    const resolved = withCharacterPortraitHash(credit, portraitHashes);
    return {
      selection,
      portrait: resolved.portrait,
      roleKey: existing?.roleKey ?? "supporting",
      spoilerLevel: existing?.spoilerLevel ?? 0,
      sortOrder: index + 1,
      notes: existing?.notes ?? null,
    } satisfies CharacterCredit;
  });
  const authorDefaults = new Map(defaults.authors.map((author) => [entityNameKey(author.creator.name), author]));
  const authorName = form.creatorName.trim();
  const authorNames = authorName ? [authorName] : [];
  const translatorDefaults = new Map(defaults.translators.map((translator) => [entityNameKey(translator.creator.name), translator]));
  const translatorName = form.translatorName.trim();
  const translatorNames = form.isTranslation && translatorName ? [translatorName] : [];
  const creatorNames = uniqueTokens([...authorNames, ...translatorNames]);
  const creators = creatorNames.map((name) => {
    const existing = authorDefaults.get(entityNameKey(name)) ?? translatorDefaults.get(entityNameKey(name));
    return { name, originalName: existing?.creator.originalName ?? null, websiteUrl: existing?.creator.websiteUrl ?? null, extra: existing?.creator.extra ?? {} } satisfies CreatorCredit;
  });
  const authorStaff = authorNames.map((creatorName) => {
    const existing = authorDefaults.get(entityNameKey(creatorName));
    return { creatorName, roleKey: "author", roleLabel: existing?.staff.roleLabel ?? "作者", notes: existing?.staff.notes ?? null } satisfies WorkStaffCredit;
  });
  const translatorStaff = translatorNames.map((creatorName) => {
    const existing = translatorDefaults.get(entityNameKey(creatorName));
    return { creatorName, roleKey: "translator", roleLabel: existing?.staff.roleLabel ?? "译者", notes: existing?.staff.notes ?? null } satisfies WorkStaffCredit;
  });
  return {
    game: { originalTitle: form.originalTitle.trim(), chineseTitle: cleanNullable(form.chineseTitle), description: cleanNullable(form.description), originalReleaseDate: releaseDate.value, originalReleasePrecision: releaseDate.precision, engineFamily: form.engineFamily, isOriginal: form.isOriginal, isTranslation: form.isTranslation, language: form.language, browsingImageBlobSha256s: imageHashes.browsingImageBlobSha256s, status: form.status, extra: {} },
    target: { mode: targetWorkId ? "update" : "create", workId: targetWorkId },
    archiveVersion: { sourceName: null, sourceUrl: cleanNullable(form.sourceUrl) },
    workTitles: uniqueTokens(form.aliasTitles).map((title) => ({ title, language: null, titleType: "alias" })),
    characters,
    creators,
    workStaff: [...authorStaff, ...translatorStaff],
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

async function prepareCharacterPortraits(
  files: CharacterPortraitFiles,
): Promise<PreparedCharacterPortraits> {
  const blobs: MetadataBlobUpload[] = [];
  const hashesBySelectionKey: Record<string, string> = {};
  for (const [key, file] of Object.entries(files)) {
    hashesBySelectionKey[key] = await prepareMetadataImage(file, blobs);
  }
  return {
    hashesBySelectionKey,
    blobs: uniqueMetadataBlobs(blobs),
  };
}

async function prepareMetadataImage(file: File, blobs: MetadataBlobUpload[]): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} 不是图片文件。`);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  blobs.push({ sha256, file, contentType: file.type });
  return sha256;
}

async function submitExternalWork(
  form: FlatMetadata,
  images: ImageSelections,
  portraits: PreparedCharacterPortraits,
): Promise<{ workId: number }> {
  if (!images.cover) throw new Error("外链作品必须提供封面图。");
  const body = new FormData();
  body.set("original_title", form.originalTitle.trim());
  body.set("chinese_title", form.chineseTitle.trim());
  body.set("description", form.description.trim());
  body.set("original_release_date", form.originalReleaseDate.trim());
  body.set("engine_family", form.engineFamily);
  if (form.isOriginal) body.set("is_original", "1");
  if (form.isTranslation) body.set("is_translation", "1");
  body.set("language", form.language);
  body.set("aliases", form.aliasTitles.join("\n"));
  body.set("tags", form.tags.join("\n"));
  body.set(
    "characters",
    JSON.stringify(
      form.characters.map((credit) =>
        withCharacterPortraitHash(credit, portraits.hashesBySelectionKey),
      ),
    ),
  );
  body.set("creator_name", form.creatorName.trim());
  body.set("translator", form.isTranslation ? form.translatorName.trim() : "");
  body.set("download_url", form.externalDownloadUrl.trim());
  body.set("source_url", form.sourceUrl.trim());
  body.set("cover", images.cover);
  for (const image of images.browsingImages) body.append("browsing_images[]", image);
  for (const portrait of portraits.blobs) {
    body.append("character_portraits[]", portrait.file);
  }
  const response = await fetch("/api/works/external", { method: "POST", body, credentials: "same-origin" });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; workId?: number; detail?: string; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.workId) throw new Error(payload?.detail || payload?.error || "发布外链作品失败。");
  return { workId: payload.workId };
}

function withCharacterPortraitHash(
  credit: CharacterCreditSelection,
  hashesBySelectionKey: Record<string, string>,
): CharacterCreditSelection {
  const uploadedHash = hashesBySelectionKey[characterSelectionKey(credit.selection)];
  return uploadedHash
    ? { ...credit, portrait: { blobSha256: uploadedHash, row: 0, column: 0 } }
    : credit;
}

function uniqueMetadataBlobs(blobs: MetadataBlobUpload[]): MetadataBlobUpload[] {
  return [...new Map(blobs.map((blob) => [blob.sha256, blob])).values()];
}

function FilePicker({ accept, directory = false, disabled = false, inputRef, label, multiple = false, onChange }: {
  accept?: string;
  directory?: boolean;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  label: string;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const id = useId();
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const controlRef = inputRef ?? fallbackInputRef;

  return (
    <div data-upload-picker>
      <Button
        aria-controls={id}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          controlRef.current?.click();
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {label}
      </Button>
      <input
        accept={accept}
        disabled={disabled}
        hidden
        id={id}
        multiple={multiple}
        onChange={onChange}
        ref={controlRef}
        type="file"
        {...(directory ? { webkitdirectory: "", directory: "" } : {})}
      />
    </div>
  );
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
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
function uniqueTokens(values: string[]): string[] { const seen = new Set<string>(); return values.filter((value) => { const key = entityNameKey(value.trim()); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function uniqueCharacterSelections(values: CharacterCreditSelection[]): CharacterCreditSelection[] { const seen = new Set<string>(); return values.filter((value) => { const key = characterSelectionKey(value.selection); if (seen.has(key)) return false; seen.add(key); return true; }); }
function phaseLabel(phase: string): string {
  const labels: Record<string, string> = { enumerating: "读取文件", hashing: "校验文件", building_core_pack: "整理公共文件", creating_import_job: "创建上传任务", preflighting: "检查已有对象", uploading_source: "上传游戏文件", verifying_source: "服务器校验游戏文件", awaiting_metadata: "等待作品资料", uploading_metadata: "上传资料图片", committing: "提交入库", completed: "完成" };
  return labels[phase] ?? "准备";
}
