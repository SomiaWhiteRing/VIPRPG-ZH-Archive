"use client";

import { useRouter } from "next/navigation";
import {
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Link as LinkIcon } from "lucide-react";
import { LanguageField } from "@/app/admin/works/language-field";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { EnginePicker } from "@/app/upload/engine-picker";
import { CharacterPicker } from "@/app/upload/character-picker";
import { inspectUploadSource } from "@/app/upload/archive-source";
import {
  ArchiveSourcePicker,
  normalizeFolderSource as normalizeSharedFolderSource,
  readDroppedFolder as readSharedDroppedFolder,
  uploadPhaseLabel,
} from "@/app/upload/archive-source-picker";
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
  CharacterSuggestion,
} from "@/lib/character-names";
import { characterSelectionKey } from "@/lib/character-names";
import { formatDate } from "@/lib/format";
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

type ImageSelections = { cover: File | null; browsingImages: File[] };
type PreparedImages = {
  hashes: { browsingImageBlobSha256s: string[] };
  blobs: MetadataBlobUpload[];
};
type CharacterFaceSheetFiles = Record<number, File[]>;
type PreparedCharacterFaceSheets = {
  hashesByIndex: Record<number, string[]>;
  blobs: MetadataBlobUpload[];
};

export type UploadInitialWork = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  engineFamily: EngineFamily;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  status: "published" | "hidden";
  aliases: string[];
  tags: string[];
  characters: CharacterCreditSelection[];
  characterCredits: CharacterCredit[];
  authors: UploadStaffCredit[];
  translators: UploadStaffCredit[];
  externalDownloadUrl: string | null;
  sourceUrl: string | null;
  previewBlobSha256s: string[];
  currentArchive: {
    name: string;
    fileCount: number;
    sizeBytes: number;
  } | null;
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
    initialForm(canArchiveUpload, currentUser.displayName, initialWork),
  );
  const [associationDefaults, setAssociationDefaults] = useState<AssociationDefaults>(
    () => initialWork
      ? {
          characters: initialWork.characterCredits,
          authors: initialWork.authors,
          translators: initialWork.translators,
        }
      : { characters: [], authors: [], translators: [] },
  );
  const [imageSelections, setImageSelections] = useState<ImageSelections>({
    cover: null,
    browsingImages: [],
  });
  const [characterFaceSheetFiles, setCharacterFaceSheetFiles] =
    useState<CharacterFaceSheetFiles>({});
  const [sourceCoverCandidates, setSourceCoverCandidates] = useState<File[]>([]);
  const sourceInspectionGenerationRef = useRef(0);
  const automaticCoverRef = useRef<File | null>(null);
  const [sourceSummary, setSourceSummary] = useState<{
    name: string;
    fileCount: number;
    sizeBytes: number;
  } | null>(null);
  const [existingArchive, setExistingArchive] = useState(initialWork?.currentArchive ?? null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
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
    existingArchive || sourceSummary || upload.active || upload.task?.sourceReady,
  );
  const externalLinkLocksType = Boolean(form.externalDownloadUrl.trim());
  const editSourceReady = archiveMode
    ? Boolean(existingArchive || upload.active)
    : externalLinkLocksType;
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
    setCharacterFaceSheetFiles((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([index]) => Number(index) < characters.length),
      ),
    );
    setForm((current) => ({ ...current, characters }));
  }

  function changeCharacterFaceSheetFiles(index: number, files: File[]) {
    setCharacterFaceSheetFiles((current) => files.length
      ? { ...current, [index]: files }
      : omitIndexedFiles(current, index));
  }

  function removeCharacterFaceSheetFiles(removedIndex: number) {
    setCharacterFaceSheetFiles((current) =>
      Object.fromEntries(
        Object.entries(current).flatMap(([rawIndex, file]) => {
          const index = Number(rawIndex);
          if (index === removedIndex) return [];
          return [[index > removedIndex ? index - 1 : index, file]];
        }),
      ),
    );
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
      const source = normalizeSharedFolderSource(rawFiles, suggestedName);
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
            webkitGetAsEntry?: () => { isDirectory: boolean } | null;
          }).webkitGetAsEntry
        : undefined;
      const entry = getEntry?.call(firstItem) ?? null;
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 1 && !entry?.isDirectory && /\.zip$/i.test(files[0].name)) {
        startSource("zip", files[0].name, [{ file: files[0], relativePath: files[0].name }]);
      } else {
        const dropped = await readSharedDroppedFolder(event.dataTransfer);
        await startFolder(dropped.files, dropped.sourceName);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "无法读取拖入的游戏文件。");
    } finally {
      setPreparing(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);
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
      if (credit.portrait) return false;
      return selection.kind === "new" || !suggestions.characters.find(
        (item) => item.id === selection.characterId,
      )?.defaultPortrait;
    });
    if (characterWithoutPortrait) {
      setSubmitError(
        `角色“${characterWithoutPortrait.selection.originalName}”还没有头像，请从素材表选择或上传脸图素材表。`,
      );
      document.getElementById("upload-characters")?.focus();
      return;
    }
    if (!imageSelections.cover && imageSelections.browsingImages.length) {
      setSubmitError("添加预览图时须同时更新封面图。");
      return;
    }
    if (!archiveMode) {
      if (!initialWork && !imageSelections.cover) {
        setSubmitError("新建外链作品必须选择封面图。");
        return;
      }
      if (!form.externalDownloadUrl.trim()) {
        setSubmitError("请填写外部下载地址。");
        return;
      }
      setPreparing(true);
      try {
        const faceSheets = await prepareCharacterFaceSheets(characterFaceSheetFiles);
        if (initialWork) {
          await submitOwnedWork(initialWork.id, "external", form, imageSelections, faceSheets);
          router.refresh();
          setSubmitSuccess("作品资料已保存。");
        } else {
          const result = await submitExternalWork(form, imageSelections, faceSheets);
          router.push(`/games/${result.workId}`);
        }
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "作品资料保存失败。");
      } finally {
        setPreparing(false);
      }
      return;
    }
    const hasArchiveSource = Boolean(existingArchive || upload.active);
    if (!hasArchiveSource) {
      setSubmitError("请先选择游戏文件。");
      return;
    }
    if (!initialWork && !imageSelections.cover) {
      setSubmitError("新建游戏必须选择封面图。");
      return;
    }
    setPreparing(true);
    try {
      const faceSheets = await prepareCharacterFaceSheets(characterFaceSheetFiles);
      if (initialWork && existingArchive && !upload.active) {
        await submitOwnedWork(initialWork.id, "archive", form, imageSelections, faceSheets);
        router.refresh();
        setSubmitSuccess("作品资料已保存。");
        return;
      }
      const images = await prepareSelectedImages(
        imageSelections,
        initialWork?.previewBlobSha256s ?? [],
      );
      upload.confirmMetadata(
        buildMetadata(
          form,
          images.hashes,
          faceSheets.hashesByIndex,
          initialWork?.id ?? null,
          associationDefaults,
        ),
        uniqueMetadataBlobs([...images.blobs, ...faceSheets.blobs]),
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "作品资料确认失败。");
    } finally {
      setPreparing(false);
    }
  }

  async function restore(draft: UploadRecoveryDraft) {
    if (!(await upload.restoreDraft(draft, { clearMetadata: Boolean(initialWork) }))) return;
    sourceInspectionGenerationRef.current += 1;
    automaticCoverRef.current = null;
    setSourceCoverCandidates([]);
    if (draft.metadata && !initialWork) {
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
      setCharacterFaceSheetFiles(
        Object.fromEntries(
          (draft.metadata.characters ?? []).flatMap((credit, index) => {
            const files = credit.faceSheetBlobSha256s
              .map((hash) => filesByHash.get(hash) ?? null)
              .filter((file): file is File => Boolean(file));
            return files.length ? [[index, files]] : [];
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
    if (upload.task?.result && sourceSummary) {
      setExistingArchive(sourceSummary);
    }
    setSourceSummary(null);
    setSubmitError(null);
    setSubmitSuccess(null);
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
                  <ArchiveSourcePicker
                    canceling={upload.canceling}
                    disabled={preparing || Boolean(sourceSummary) || upload.active}
                    existingSource={sourceSummary ? null : existingArchive}
                    mode={mode}
                    onCancel={() => void cancelUpload()}
                    onDrop={onSourceDrop}
                    onFolder={(files, sourceName) => void startFolder(files, sourceName)}
                    onModeChange={setMode}
                    onRemoveExisting={() => {
                      setExistingArchive(null);
                      setSubmitError(null);
                      setSubmitSuccess(null);
                    }}
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
                    characterFaceSheetFiles={characterFaceSheetFiles}
                    changeOriginalDeclaration={changeOriginalDeclaration}
                    changeCharacterFaceSheetFiles={changeCharacterFaceSheetFiles}
                    changeCharacters={changeCharacters}
                    removeCharacterFaceSheetFiles={removeCharacterFaceSheetFiles}
                    changeTranslationDeclaration={changeTranslationDeclaration}
                    changeTranslatorName={changeTranslatorName}
                    disabled={preparing}
                    existingPreviewCount={Math.max(
                      0,
                      (initialWork?.previewBlobSha256s.length ?? 0) - 1,
                    )}
                    form={form}
                    imageSelections={imageSelections}
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
                    required={!initialWork?.previewBlobSha256s.length}
                  />
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
                    existingArchive={existingArchive}
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
                        aria-label="公开状态"
                        disabled={formDisabled}
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
                  {submitSuccess ? (
                    <p className="border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
                      {submitSuccess}
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
                      disabled={preparing || Boolean(initialWork && !editSourceReady)}
                      type="submit"
                      variant="rm2k"
                    >
                      {preparing
                        ? archiveMode
                          ? "正在确认…"
                          : "正在发布…"
                        : initialWork
                          ? "保存作品资料"
                        : archiveMode
                          ? "确认作品资料"
                          : "发布外链作品"}
                    </Button>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </form>
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
          保存库不支持提交RM2k系以外作品，您可以提交外部网盘链接。
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
  characterFaceSheetFiles,
  changeCharacterFaceSheetFiles,
  changeCharacters,
  changeOriginalDeclaration,
  changeTranslationDeclaration,
  changeTranslatorName,
  disabled,
  existingPreviewCount,
  form,
  imageSelections,
  removeCharacterFaceSheetFiles,
  setForm,
  setImageSelections,
  suggestions,
  translatorError,
}: {
  characterFaceSheetFiles: CharacterFaceSheetFiles;
  changeCharacterFaceSheetFiles: (index: number, files: File[]) => void;
  changeCharacters: (characters: CharacterCreditSelection[]) => void;
  changeOriginalDeclaration: (checked: boolean) => void;
  changeTranslationDeclaration: (checked: boolean) => void;
  changeTranslatorName: (value: string) => void;
  disabled: boolean;
  existingPreviewCount: number;
  form: FlatMetadata;
  imageSelections: ImageSelections;
  removeCharacterFaceSheetFiles: (index: number) => void;
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
            faceSheetFiles={characterFaceSheetFiles}
            id="upload-characters"
            onChange={changeCharacters}
            onFaceSheetFilesChange={changeCharacterFaceSheetFiles}
            onFaceSheetFilesRemove={removeCharacterFaceSheetFiles}
            suggestions={suggestions.characters}
            values={form.characters}
          />
        </WorkbenchField>
        <details className="md:col-span-2">
          <summary className="cursor-pointer py-1 text-sm font-bold">更多设置</summary>
          <div className="mt-3 grid gap-4 border-t border-border pt-4">
            <WorkbenchField label="预览图">
              <PreviewPicker disabled={disabled} existingCount={existingPreviewCount} files={imageSelections.browsingImages} onChange={(browsingImages) => setImageSelections((current) => ({ ...current, browsingImages }))} />
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

function ReadinessList({ archiveMode, existingArchive, metadataConfirmed, preparing, sourceSummary, task }: {
  archiveMode: boolean;
  existingArchive: { name: string; fileCount: number; sizeBytes: number } | null;
  metadataConfirmed: boolean;
  preparing: boolean;
  sourceSummary: { name: string; fileCount: number; sizeBytes: number } | null;
  task: BrowserUploadTaskSnapshot | null;
}) {
  const items = archiveMode
    ? [
        { label: "游戏文件", value: existingArchive || task?.sourceReady ? "已就绪" : task ? uploadPhaseLabel(task.phase) : sourceSummary ? "准备中" : "尚未选择", tone: existingArchive || task?.sourceReady ? "ready" : task ? "running" : "idle" },
        { label: "作品资料", value: task?.commitStarted ? "已锁定" : metadataConfirmed ? "已确认" : "编辑中", tone: metadataConfirmed ? "ready" : "idle" },
        { label: "发布", value: task?.result ? "已完成" : task?.commitStarted ? uploadPhaseLabel(task.phase) : task?.sourceReady && !metadataConfirmed ? "等待作品资料" : !task?.sourceReady && metadataConfirmed ? "等待游戏文件" : "等待两项就绪", tone: task?.result ? "ready" : task?.commitStarted ? "running" : "idle" },
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
  canArchiveUpload: boolean,
  displayName: string,
  initialWork: UploadInitialWork | null,
): FlatMetadata {
  if (initialWork) {
    return {
      originalTitle: initialWork.originalTitle,
      chineseTitle: initialWork.chineseTitle ?? "",
      aliasTitles: initialWork.aliases,
      engineFamily: initialWork.engineFamily,
      description: initialWork.description ?? "",
      tags: initialWork.tags,
      characters: initialWork.characters,
      creatorName: initialWork.authors[0]?.creator.name ?? "",
      translatorName: initialWork.translators[0]?.creator.name ?? "",
      originalReleaseDate: initialWork.originalReleaseDate ?? "",
      isOriginal: initialWork.isOriginal,
      isTranslation: initialWork.isTranslation,
      language: initialWork.language,
      sourceUrl: initialWork.sourceUrl ?? "",
      externalDownloadUrl: initialWork.externalDownloadUrl ?? "",
      status: initialWork.status,
    };
  }
  return {
    originalTitle: "",
    chineseTitle: "",
    aliasTitles: [],
    engineFamily: canArchiveUpload ? "rpg_maker_2000" : "other",
    description: "",
    tags: [],
    characters: [],
    creatorName: "",
    translatorName: displayName,
    originalReleaseDate: "",
    isOriginal: false,
    isTranslation: false,
    language: "zh-CN",
    sourceUrl: "",
    externalDownloadUrl: "",
    status: "published",
  };
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
    characters: (metadata.characters ?? []).map(({
      selection,
      portrait,
      faceSheetBlobSha256s,
    }) => ({ selection, portrait, faceSheetBlobSha256s })),
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
  faceSheetHashes: Record<number, string[]>,
  targetWorkId: number | null,
  defaults: AssociationDefaults,
): ArchiveCommitMetadata {
  const releaseDate = parseOriginalReleaseDate(form.originalReleaseDate);
  if (!releaseDate) throw new Error(ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
  const characterDefaults = groupCharacterDefaults(defaults.characters);
  const characters = form.characters.map((credit, index) => {
    const selection = credit.selection;
    const existing = takeCharacterDefault(characterDefaults, credit);
    const resolved = withCharacterFaceSheetHashes(credit, index, faceSheetHashes);
    return {
      selection,
      portrait: resolved.portrait,
      faceSheetBlobSha256s: resolved.faceSheetBlobSha256s,
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

async function prepareSelectedImages(
  input: ImageSelections,
  retainedHashes: string[] = [],
): Promise<PreparedImages> {
  if (!input.cover) {
    return {
      hashes: { browsingImageBlobSha256s: retainedHashes },
      blobs: [],
    };
  }
  const blobs: MetadataBlobUpload[] = [];
  const hashes: string[] = [];
  if (input.cover) hashes.push(await prepareMetadataImage(input.cover, blobs));
  for (const file of input.browsingImages) hashes.push(await prepareMetadataImage(file, blobs));
  return { hashes: { browsingImageBlobSha256s: hashes }, blobs: [...new Map(blobs.map((blob) => [blob.sha256, blob])).values()] };
}

async function prepareCharacterFaceSheets(
  files: CharacterFaceSheetFiles,
): Promise<PreparedCharacterFaceSheets> {
  const blobs: MetadataBlobUpload[] = [];
  const hashesByIndex: Record<number, string[]> = {};
  for (const [rawIndex, faceSheets] of Object.entries(files)) {
    hashesByIndex[Number(rawIndex)] = await Promise.all(
      faceSheets.map((file) => prepareMetadataImage(file, blobs)),
    );
  }
  return {
    hashesByIndex,
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
  faceSheets: PreparedCharacterFaceSheets,
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
      form.characters.map((credit, index) =>
        withCharacterFaceSheetHashes(credit, index, faceSheets.hashesByIndex),
      ),
    ),
  );
  body.set("creator_name", form.creatorName.trim());
  body.set("translator", form.isTranslation ? form.translatorName.trim() : "");
  body.set("download_url", form.externalDownloadUrl.trim());
  body.set("source_url", form.sourceUrl.trim());
  body.set("cover", images.cover);
  for (const image of images.browsingImages) body.append("browsing_images[]", image);
  for (const faceSheet of faceSheets.blobs) {
    body.append("character_face_sheets[]", faceSheet.file);
  }
  const response = await fetch("/api/works/external", { method: "POST", body, credentials: "same-origin" });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; workId?: number; detail?: string; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.workId) throw new Error(payload?.detail || payload?.error || "发布外链作品失败。");
  return { workId: payload.workId };
}

async function submitOwnedWork(
  workId: number,
  distribution: "archive" | "external",
  form: FlatMetadata,
  images: ImageSelections,
  faceSheets: PreparedCharacterFaceSheets,
): Promise<void> {
  const body = new FormData();
  body.set("distribution", distribution);
  body.set("original_title", form.originalTitle.trim());
  body.set("chinese_title", form.chineseTitle.trim());
  body.set("description", form.description.trim());
  body.set("original_release_date", form.originalReleaseDate.trim());
  body.set("engine_family", form.engineFamily);
  if (form.isOriginal) body.set("is_original", "1");
  if (form.isTranslation) body.set("is_translation", "1");
  body.set("language", form.language);
  body.set("status", form.status);
  body.set("aliases", form.aliasTitles.join("\n"));
  body.set("tags", form.tags.join("\n"));
  body.set(
    "characters",
    JSON.stringify(
      form.characters.map((credit, index) =>
        withCharacterFaceSheetHashes(credit, index, faceSheets.hashesByIndex),
      ),
    ),
  );
  body.set("author", form.creatorName.trim());
  body.set("translator", form.isTranslation ? form.translatorName.trim() : "");
  body.set("download_url", distribution === "external" ? form.externalDownloadUrl.trim() : "");
  body.set("source_url", distribution === "external" ? form.sourceUrl.trim() : "");
  if (images.cover) {
    body.append("images[]", images.cover);
    for (const image of images.browsingImages) body.append("images[]", image);
  }
  for (const faceSheet of faceSheets.blobs) {
    body.append("character_face_sheets[]", faceSheet.file);
  }
  const response = await fetch(`/api/works/${workId}/owned`, {
    method: "POST",
    body,
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    detail?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.detail || payload?.error || "作品资料保存失败。");
  }
}

function withCharacterFaceSheetHashes(
  credit: CharacterCreditSelection,
  index: number,
  hashesByIndex: Record<number, string[]>,
): CharacterCreditSelection {
  return {
    ...credit,
    faceSheetBlobSha256s: hashesByIndex[index] ?? [],
  };
}

function groupCharacterDefaults(
  values: CharacterCredit[],
): Map<string, CharacterCredit[]> {
  const result = new Map<string, CharacterCredit[]>();
  for (const value of values) {
    const key = characterSelectionKey(value.selection);
    const group = result.get(key) ?? [];
    group.push(value);
    result.set(key, group);
  }
  return result;
}

function takeCharacterDefault(
  values: Map<string, CharacterCredit[]>,
  credit: CharacterCreditSelection,
): CharacterCredit | undefined {
  const group = values.get(characterSelectionKey(credit.selection));
  if (!group?.length) return undefined;
  const matchingIndex = group.findIndex(
    (value) => value.selection.displayName === credit.selection.displayName,
  );
  return group.splice(matchingIndex < 0 ? 0 : matchingIndex, 1)[0];
}

function uniqueMetadataBlobs(blobs: MetadataBlobUpload[]): MetadataBlobUpload[] {
  return [...new Map(blobs.map((blob) => [blob.sha256, blob])).values()];
}

function omitIndexedFiles(
  value: CharacterFaceSheetFiles,
  index: number,
): CharacterFaceSheetFiles {
  if (!(index in value)) return value;
  const next = { ...value };
  delete next[index];
  return next;
}

function entityNameKey(value: string): string { return value.toLocaleLowerCase(); }
function cleanNullable(value: string): string | null { return value.trim() || null; }
function uniqueTokens(values: string[]): string[] { const seen = new Set<string>(); return values.filter((value) => { const key = entityNameKey(value.trim()); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
