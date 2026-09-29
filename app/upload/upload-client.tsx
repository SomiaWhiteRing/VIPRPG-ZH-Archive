import { normalizeWorkGenre } from "@/lib/work-genre";
import { WorkMetadataFields } from "@/app/components/work/work-metadata-fields";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";

import { ARCHIVE_UPLOAD_PERMISSIONS } from "@/lib/authz/permissions";

import type { ConfirmedCreatorSelection } from "@/lib/creator-names";

import {
  CoverPicker,
} from "@/app/components/media/media-picker";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { LanguageField } from "@/app/components/work/language-field";
import {
  moreInfoRows,
} from "@/app/components/work/work-more-info-editor";
import {
  ArchiveSourcePicker,
  normalizeFolderSource as normalizeSharedFolderSource,
  readDroppedFolder as readSharedDroppedFolder,
  uploadPhaseLabel,
} from "@/app/upload/archive-source-picker";
import { EnginePicker } from "@/app/upload/engine-picker";
import {
  extraStaffCredits,
  staffRowErrors,
  staffRows,
} from "@/app/upload/staff-editor";
import {
  readTranslationPreference,
  rememberPublishedTranslators,
  updateTranslationPreference,
} from "@/app/upload/translation-preference";
import { useUploadController } from "@/app/upload/upload-controller";
import { useMissingResourcesPreference, useResourceCleanupPreference, useSharedPlayerPreference } from "@/app/upload/advanced-options-preference";
import type {
  BrowserUploadTaskSnapshot,
  MetadataBlobUpload,
  UploadAssociationDefaults as AssociationDefaults,
  UploadFormMetadata as FlatMetadata,
  UploadImageSelections as ImageSelections,
  UploadRecoveryDraft,
  UploadSourceFile,
  UploadSourceKind,
  UploadSourcePrefill,
  UploadTaxonomySuggestion,
} from "@/app/upload/upload-types";
import type { ArchiveCommitMetadata } from "@/lib/archive/manifest";
import type {
  CharacterCreditSelection,
  CharacterSuggestion,
} from "@/lib/character-names";
import { characterSelectionKey } from "@/lib/character-names";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import { creatorSelectionKey } from "@/lib/creator-names";
import { formatDate } from "@/lib/format";
import { isArchiveEngineFamily } from "@/lib/labels";
import {
  ORIGINAL_RELEASE_DATE_FORMAT_ERROR,
  parseOriginalReleaseDate,
} from "@/lib/original-release-date";
import { cn } from "@/lib/ui/cn";
import type { WorkMoreInfo } from "@/lib/work-more-info";
import { moreInfoItemError, normalizeWorkMoreInfo } from "@/lib/work-more-info";
import { Check, Link as LinkIcon } from "lucide-react";
import type { DragEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

type EngineFamily = ArchiveCommitMetadata["game"]["engineFamily"];
type CharacterCredit = NonNullable<ArchiveCommitMetadata["characters"]>[number];
type WorkStaffCredit = ArchiveCommitMetadata["workStaff"][number];
export type UploadStaffCredit = WorkStaffCredit;
type CurrentUser = {
  id: number;
  displayName: string;
  permissionKeys: string[];
};

type PreparedImages = {
  hashes: { coverBlobSha256: string; previewBlobSha256s: string[] };
  blobs: MetadataBlobUpload[];
};
type CharacterFaceSheetFiles = Record<number, File[]>;
type PreparedCharacterFaceSheets = {
  hashesByIndex: Record<number, string[]>;
  blobs: MetadataBlobUpload[];
};

export type UploadInitialWork = {
  usesUnsupportedManiac: boolean;
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  genre: string | null;
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
  extraStaff: UploadStaffCredit[];
  moreInfo: WorkMoreInfo[];
  translators: UploadStaffCredit[];
  externalDownloadUrl: string | null;
  archiveSourceUrl: string | null;
  coverBlobSha256: string;
  previewBlobSha256s: string[];
  currentArchive: {
    usesSharedPlayer: boolean;
    name: string;
    fileCount: number;
    sizeBytes: number;
  } | null;
};

export function UploadClient({
  currentUser,
  initialWork = null,
  saveRedirectTo = "/me/uploads",
  suggestions,
}: {
  currentUser: CurrentUser;
  initialWork?: UploadInitialWork | null;
  saveRedirectTo?: string;
  suggestions: {
    tags: UploadTaxonomySuggestion[];
    characters: CharacterSuggestion[];
    creators: CreatorSuggestion[];
  };
}) {
  const navigate = useNavigate();
  const upload = useUploadController(currentUser.id);
  const canArchiveUpload = ARCHIVE_UPLOAD_PERMISSIONS.every((key) =>
    currentUser.permissionKeys.includes(key),
  );
  const [mode, setMode] = useState<UploadSourceKind>("folder");
  const [cleanupResources, setCleanupResources] = useResourceCleanupPreference();
  const [sharedPlayerPreference, setSharedPlayerPreference] = useSharedPlayerPreference();
  const [sharedPlayerOverride, setSharedPlayerOverride] = useState<boolean | null>(
    initialWork?.currentArchive?.usesSharedPlayer ?? null,
  );
  const useSharedPlayer = sharedPlayerOverride ?? sharedPlayerPreference;
  const [checkMissingResources, setCheckMissingResources] = useMissingResourcesPreference();

  function changeSharedPlayer(enabled: boolean) {
    setSharedPlayerOverride(enabled);
    setSharedPlayerPreference(enabled);
  }
  const [form, setForm] = useState<FlatMetadata>(() =>
    initialForm(canArchiveUpload, currentUser, initialWork),
  );
  const [associationDefaults, setAssociationDefaults] =
    useState<AssociationDefaults>(() =>
      initialWork
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
    replacePreviews: false,
  });
  const [characterFaceSheetFiles, setCharacterFaceSheetFiles] =
    useState<CharacterFaceSheetFiles>({});
  const [sourceFaceSheetFiles, setSourceFaceSheetFiles] = useState<File[]>([]);
  const [sourceFaceSheetWarnings, setSourceFaceSheetWarnings] = useState<string[]>([]);
  const [sourceCoverCandidates, setSourceCoverCandidates] = useState<File[]>(
    [],
  );
  const sourceInspectionGenerationRef = useRef(0);
  const automaticCoverRef = useRef<File | null>(null);
  const [sourceSummary, setSourceSummary] = useState<{
    name: string;
    fileCount: number;
    sizeBytes: number;
  } | null>(null);
  const [existingArchive, setExistingArchive] = useState(
    initialWork?.currentArchive ?? null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const toast = useToast();
  const [staffErrorsVisible, setStaffErrorsVisible] = useState(false);
  const [moreInfoErrorsVisible, setMoreInfoErrorsVisible] = useState(false);
  const [translatorError, setTranslatorError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const coverCandidates = useMemo(
    () => [...sourceCoverCandidates, ...imageSelections.browsingImages],
    [imageSelections.browsingImages, sourceCoverCandidates],
  );
  const archiveMode = isArchiveEngineFamily(form.engineFamily);
  const uploadResult = upload.task?.result;
  const metadataLocked =
    upload.metadataConfirmed || Boolean(upload.task?.commitStarted);
  const formDisabled = preparing || metadataLocked;
  const gameFileLocksType = Boolean(
    existingArchive ||
      sourceSummary ||
      upload.active ||
      upload.task?.sourceReady,
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
  const { saveFormDraft } = upload;
  const localTaskId = upload.task?.localTaskId;

  useEffect(() => {
    saveFormDraft({
      form,
      associationDefaults,
      imageSelections,
      characterFaceSheetFiles,
      sourceFaceSheetFiles,
      sourceFaceSheetWarnings,
    });
  }, [
    form,
    associationDefaults,
    imageSelections,
    characterFaceSheetFiles,
    sourceFaceSheetFiles,
    sourceFaceSheetWarnings,
    localTaskId,
    saveFormDraft,
  ]);

  useEffect(() => {
    if (initialWork) return;
    const timeoutId = window.setTimeout(() => {
      const preference = readTranslationPreference(currentUser.id);
      if (!preference) return;
      setForm((current) => ({
        ...current,
        isOriginal: false,
        isTranslation: preference.isTranslation,
        translators: preference.translators !== null
          ? preference.translators
          : [
              newTranslator({
                id: currentUser.id,
                displayName: currentUser.displayName,
              }),
            ],
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

  function changeTranslator(value: (CreatorSelection | null)[]) {
    setTranslatorError(null);
    setForm((current) => ({ ...current, translators: value }));
    updateTranslationPreference(currentUser.id, {
      isTranslation: form.isTranslation,
      ...(value.every((item) => item?.kind === "existing")
        ? { translators: value as ConfirmedCreatorSelection[] }
        : {}),
    });
  }

  function changeCharacters(
    characters: CharacterCreditSelection[],
    reorderedIndices?: number[],
  ) {
    setCharacterFaceSheetFiles((current) =>
      reorderedIndices
        ? Object.fromEntries(
            reorderedIndices.flatMap((oldIndex, index) =>
              current[oldIndex] ? [[index, current[oldIndex]]] : [],
            ),
          )
        : Object.fromEntries(
            Object.entries(current).filter(
              ([index]) => Number(index) < characters.length,
            ),
          ),
    );
    setForm((current) => ({ ...current, characters }));
  }

  function changeCharacterFaceSheetFiles(index: number, files: File[]) {
    setCharacterFaceSheetFiles((current) =>
      files.length
        ? { ...current, [index]: files }
        : omitIndexedFiles(current, index),
    );
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

  function prefillSourceMetadata(
    prefill: UploadSourcePrefill,
    canPrefill: { originalTitle: boolean; chineseTitle: boolean },
    generation: number,
  ) {
    if (generation !== sourceInspectionGenerationRef.current) return;
    setSourceCoverCandidates(prefill.titleImages);
    setSourceFaceSheetFiles(prefill.faceSheetFiles);
    setSourceFaceSheetWarnings(prefill.faceSheetWarnings);
    const title = prefill.gameTitle;
    if (title) {
      setForm((current) => {
        const field =
          (current.language === "zh-CN" || current.language === "zh-TW") &&
          !/[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(title)
            ? "chineseTitle"
            : "originalTitle";
        return canPrefill[field] && !current[field].trim()
          ? { ...current, [field]: title }
          : current;
      });
    }

    const earliestTitleImage = prefill.titleImages[0];
    if (!earliestTitleImage || initialWork?.coverBlobSha256) return;

    setImageSelections((current) => {
      if (current.cover) return current;
      automaticCoverRef.current = earliestTitleImage;
      return { ...current, cover: earliestTitleImage };
    });
  }

  async function startFolder(
    rawFiles: UploadSourceFile[],
    suggestedName: string,
  ) {
    setSubmitError(null);
    try {
      const source = normalizeSharedFolderSource(rawFiles, suggestedName);
      if (
        !source.files.some(
          (item) => item.relativePath.toLowerCase() === "rpg_rt.lmt",
        )
      ) {
        throw new Error("所选文件夹根目录缺少 RPG_RT.lmt，请选择游戏根目录。");
      }
      startSource("folder", source.sourceName, source.files);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "无法读取所选文件夹。",
      );
    }
  }

  function startSource(
    sourceKind: UploadSourceKind,
    sourceName: string,
    files: UploadSourceFile[],
  ) {
    const sizeBytes = files.reduce((sum, item) => sum + item.file.size, 0);
    const canPrefill = {
      originalTitle: !form.originalTitle.trim(),
      chineseTitle: !form.chineseTitle.trim(),
    };
    const generation = sourceInspectionGenerationRef.current + 1;
    sourceInspectionGenerationRef.current = generation;
    setSourceCoverCandidates([]);
    setSourceFaceSheetFiles([]);
    setSourceFaceSheetWarnings([]);
    const previousAutomaticCover = automaticCoverRef.current;
    automaticCoverRef.current = null;
    if (previousAutomaticCover) {
      setImageSelections((current) =>
        current.cover === previousAutomaticCover
          ? { ...current, cover: null }
          : current,
      );
    }
    setMode(sourceKind);
    setSourceSummary({ name: sourceName, fileCount: files.length, sizeBytes });
    upload.startSource(
      { sourceKind, sourceName, files, cleanupResources, useSharedPlayer, checkMissingResources, targetWorkId: initialWork?.id ?? null },
      (prefill) => prefillSourceMetadata(prefill, canPrefill, generation),
    );
  }

  function startArchive(file: File) {
    setSubmitError(null);
    const extension = file.name.match(/\.(zip|7z)$/i)?.[1].toLowerCase();
    if (extension !== "zip" && extension !== "7z") {
      setSubmitError("请选择 ZIP 或 7z 压缩包；分卷压缩包请先解压后选择游戏文件夹。");
      return;
    }
    startSource(extension, file.name, [{ file, relativePath: file.name }]);
  }

  async function onSourceDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (preparing || sourceSummary || upload.active) return;
    setPreparing(true);
    try {
      const firstItem = event.dataTransfer.items[0];
      const getEntry = firstItem
        ? (
            firstItem as DataTransferItem & {
              webkitGetAsEntry?: () => { isDirectory: boolean } | null;
            }
          ).webkitGetAsEntry
        : undefined;
      const entry = getEntry?.call(firstItem) ?? null;
      const files = Array.from(event.dataTransfer.files);
      if (
        files.length === 1 &&
        !entry?.isDirectory &&
        /\.(?:zip|7z)(?:\.\d+)?$/i.test(files[0].name)
      ) {
        startArchive(files[0]);
      } else {
        const dropped = await readSharedDroppedFolder(event.dataTransfer);
        await startFolder(dropped.files, dropped.sourceName);
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "无法读取拖入的游戏文件。",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setSubmitError(null);
    setTranslatorError(null);
    setStaffErrorsVisible(true);
    setMoreInfoErrorsVisible(true);
    const staffErrors = staffRowErrors(form.extraStaff);
    const invalidStaffIndex = staffErrors.findIndex(Boolean);
    if (invalidStaffIndex >= 0) {
      const details = document.getElementById(
        "upload-more-settings",
      ) as HTMLDetailsElement | null;
      if (details) details.open = true;
      requestAnimationFrame(() =>
        document
          .getElementById(
            `staff-${form.extraStaff[invalidStaffIndex].id}-${staffErrors[invalidStaffIndex]?.field}`,
          )
          ?.focus(),
      );
      return;
    }
    const invalidMoreInfoIndex = form.moreInfo.findIndex((item) =>
      moreInfoItemError(item),
    );
    if (invalidMoreInfoIndex >= 0) {
      const details = document.getElementById(
        "upload-more-settings",
      ) as HTMLDetailsElement | null;
      if (details) details.open = true;
      const row = form.moreInfo[invalidMoreInfoIndex];
      requestAnimationFrame(() =>
        document
          .getElementById(
            `upload-more-info-${row.id}-${moreInfoItemError(row)?.field}`,
          )
          ?.focus(),
      );
      return;
    }
    if (form.isOriginal && form.isTranslation) {
      setSubmitError("原创声明与翻译声明不能同时选择。");
      return;
    }
    if (
      form.isTranslation &&
      form.translators.some((item) => item !== null && !item.displayName.trim())
    ) {
      setTranslatorError("请填写译者。");
      document.getElementById("upload-translator")?.focus();
      return;
    }
    if (!form.originalTitle.trim()) {
      setSubmitError("请填写作品原名。");
      return;
    }
    const releaseDate = parseOriginalReleaseDate(form.originalReleaseDate);
    if (!releaseDate) {
      setSubmitError(ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
      document.getElementById("upload-release-date")?.focus();
      return;
    }
    const characterWithoutPortrait = form.characters.find((credit) => {
      const selection = credit.selection;
      if (credit.portrait) return false;
      return (
        selection.kind === "new" ||
        !suggestions.characters.find(
          (item) => item.id === selection.characterId,
        )?.defaultPortrait
      );
    });
    if (characterWithoutPortrait) {
      setSubmitError(
        `角色“${characterWithoutPortrait.selection.originalName}”还没有头像，请从素材表选择或上传脸图素材表。`,
      );
      document.getElementById("upload-characters")?.focus();
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
        const faceSheets = await prepareCharacterFaceSheets(
          characterFaceSheetFiles,
        );
        if (initialWork) {
          rememberPublishedTranslators(
            currentUser.id,
            await submitOwnedWork(
              initialWork.id,
              "external",
              form,
              imageSelections,
              faceSheets,
            ),
          );
          toast.success("作品资料已保存。");
          navigate(saveRedirectTo);
        } else {
          const result = await submitExternalWork(
            form,
            imageSelections,
            faceSheets,
          );
          rememberPublishedTranslators(currentUser.id, result.translators);
          toast.success("作品已发布。");
          navigate(`/games/${result.workId}`);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "作品资料保存失败。",
        );
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
      const faceSheets = await prepareCharacterFaceSheets(
        characterFaceSheetFiles,
      );
      if (initialWork && existingArchive && !upload.active) {
        rememberPublishedTranslators(
          currentUser.id,
          await submitOwnedWork(
            initialWork.id,
            "archive",
            form,
            imageSelections,
            faceSheets,
          ),
        );
        toast.success("作品资料已保存。");
        navigate(saveRedirectTo);
        return;
      }
      const images = await prepareSelectedImages(
        imageSelections,
        initialWork,
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
      toast.error(
        error instanceof Error ? error.message : "作品资料确认失败。",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function restore(draft: UploadRecoveryDraft) {
    if (!(await upload.restoreDraft(draft))) return;
    sourceInspectionGenerationRef.current += 1;
    automaticCoverRef.current = null;
    setSourceCoverCandidates([]);
    setSourceFaceSheetFiles(draft.formDraft?.sourceFaceSheetFiles ?? []);
    setSourceFaceSheetWarnings(draft.formDraft?.sourceFaceSheetWarnings ?? []);
    if (draft.formDraft) {
      setForm({ ...draft.formDraft.form, genre: draft.formDraft.form.genre ?? "" });
      setAssociationDefaults(draft.formDraft.associationDefaults);
      setImageSelections(draft.formDraft.imageSelections);
      setCharacterFaceSheetFiles(draft.formDraft.characterFaceSheetFiles);
      setTranslatorError(null);
      setStaffErrorsVisible(false);
      setMoreInfoErrorsVisible(false);
    } else if (draft.metadata && !initialWork) {
      setForm(formFromMetadata(draft.metadata));
      setTranslatorError(null);
      setAssociationDefaults(associationsFromMetadata(draft.metadata));
      const filesByHash = new Map(
        draft.metadataBlobs.map((blob) => [blob.sha256, blob.file]),
      );
      const previewFiles = draft.metadata.game.previewBlobSha256s
        .map((hash) => filesByHash.get(hash) ?? null)
        .filter((file): file is File => Boolean(file));
      setImageSelections({
        cover: filesByHash.get(draft.metadata.game.coverBlobSha256) ?? null,
        browsingImages: previewFiles,
        replacePreviews: true,
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
    setSharedPlayerOverride(draft.preparedSource.useSharedPlayer ?? false);
    setSourceSummary({
      name: draft.preparedSource.sourceName,
      fileCount: draft.preparedSource.stats.sourceFileCount,
      sizeBytes: draft.preparedSource.stats.sourceSizeBytes,
    });
  }

  function restart() {
    sourceInspectionGenerationRef.current += 1;
    setSourceCoverCandidates([]);
    setSourceFaceSheetFiles([]);
    setSourceFaceSheetWarnings([]);
    const previousAutomaticCover = automaticCoverRef.current;
    automaticCoverRef.current = null;
    if (previousAutomaticCover) {
      setImageSelections((current) =>
        current.cover === previousAutomaticCover
          ? { ...current, cover: null }
          : current,
      );
    }
    upload.resetTask();
    if (upload.task?.result && sourceSummary) {
      setExistingArchive({ ...sourceSummary, usesSharedPlayer: useSharedPlayer });
    }
    setSourceSummary(null);
    setSubmitError(null);
  }

  async function cancelUpload() {
    if (await upload.cancelTask()) restart();
  }

  return (
    <div
      className="grid gap-5"
      data-upload-phase={upload.task?.phase ?? "idle"}
    >
      {relevantDrafts.length ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="m-0 text-base font-bold">可继续的上传</h2>
          </header>
          <ul className="divide-y divide-border px-4">
            {relevantDrafts.map((draft) => {
              const committing = upload.committingDraftIds.includes(
                draft.serverImportJobId,
              );
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  key={draft.key}
                >
                  <div className="min-w-0">
                    <strong className="block truncate">
                      {draft.preparedSource.sourceName}
                    </strong>
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
        <Notice tone="error" className="border p-3 text-sm" role="alert">
          {upload.controllerError}
        </Notice>
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
                if (
                  option.distribution === "external" &&
                  !initialWork &&
                  !currentUser.permissionKeys.includes("work.external_create")
                ) {
                  return "当前账户没有外链作品发布权限";
                }
                const targetArchive = option.distribution === "archive";
                if (targetArchive === archiveMode) return null;
                if (gameFileLocksType)
                  return "已有游戏文件，不能切换到外链类型";
                if (externalLinkLocksType)
                  return "请先清空外部下载链接再切换到保存库类型";
                return null;
              }}
              onValueChange={(engineFamily) => {
                setSubmitError(null);
                setForm((current) => ({
                  ...current,
                  engineFamily,
                  usesUnsupportedManiac:
                    engineFamily === "rpg_maker_2003_maniac" && current.usesUnsupportedManiac,
                }));
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
                    cleanupResources={cleanupResources}
                    checkMissingResources={checkMissingResources}
                    onCheckMissingResourcesChange={setCheckMissingResources}
                    onCleanupResourcesChange={setCleanupResources}
                    useSharedPlayer={useSharedPlayer}
                    onUseSharedPlayerChange={changeSharedPlayer}
                    disabled={
                      !canArchiveUpload ||
                      preparing ||
                      Boolean(sourceSummary) ||
                      upload.active
                    }
                    existingSource={sourceSummary ? null : existingArchive}
                    mode={mode}
                    onCancel={() => void cancelUpload()}
                    onDrop={onSourceDrop}
                    onFolder={(files, sourceName) =>
                      void startFolder(files, sourceName)
                    }
                    onRemoveExisting={() => {
                      setExistingArchive(null);
                      setSubmitError(null);
                    }}
                    onRestart={restart}
                    onArchive={startArchive}
                    sourceSummary={sourceSummary}
                    task={upload.task}
                  />
                ) : (
                  <ExternalSourceSection
                    disabled={formDisabled}
                    onChange={(externalDownloadUrl) =>
                      setForm((current) => ({
                        ...current,
                        externalDownloadUrl,
                      }))
                    }
                    value={form.externalDownloadUrl}
                  />
                )}
              </section>

              <section className="p-4 sm:p-5">
                {uploadResult || upload.metadataConfirmed ? (
                  <div className="grid min-h-44 place-items-center text-center">
                    <div>
                      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700">
                        <Check className="size-5" />
                      </span>
                      <h2 aria-live="polite" className="m-0 text-lg font-bold">
                        {uploadResult ? "上传完成" : "作品资料已确认"}
                      </h2>
                      <p className="mt-1 text-sm text-muted">
                        {form.chineseTitle.trim() || form.originalTitle.trim()}
                      </p>
                      {uploadResult ? (
                        <Button asChild className="mt-4" variant="rm2k">
                          <Link to={`/games/${uploadResult.workId}`}>
                            查看作品
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <WorkMetadataFields
                    characterFaceSheetFiles={characterFaceSheetFiles}
                    sourceFaceSheetFiles={sourceFaceSheetFiles}
                    sourceFaceSheetWarnings={sourceFaceSheetWarnings}
                    sourceFaceSheetsLoading={upload.active && (!upload.task || upload.task.phase === "enumerating")}
                    changeOriginalDeclaration={changeOriginalDeclaration}
                    changeCharacterFaceSheetFiles={
                      changeCharacterFaceSheetFiles
                    }
                    changeCharacters={changeCharacters}
                    removeCharacterFaceSheetFiles={
                      removeCharacterFaceSheetFiles
                    }
                    changeTranslationDeclaration={changeTranslationDeclaration}
                    changeTranslator={changeTranslator}
                    disabled={preparing}
                    existingPreviewHashes={initialWork?.previewBlobSha256s ?? []}
                    existingImageBaseUrl={initialWork ? `/api/works/${initialWork.id}/media/` : undefined}
                    form={form}
                    imageSelections={imageSelections}
                    setForm={setForm}
                    setImageSelections={setImageSelections}
                    suggestions={suggestions}
                    staffErrorsVisible={staffErrorsVisible}
                    moreInfoErrorsVisible={moreInfoErrorsVisible}
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
                    existingCoverBlobSha256={initialWork?.coverBlobSha256}
                    existingImageBaseUrl={initialWork ? `/api/works/${initialWork.id}/media/` : undefined}
                    file={imageSelections.cover}
                    includeSelectedFileCandidate={
                      imageSelections.cover !== automaticCoverRef.current
                    }
                    onChange={(cover) => {
                      automaticCoverRef.current = null;
                      setImageSelections((current) => ({ ...current, cover }));
                    }}
                    required={!initialWork?.coverBlobSha256}
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

                <fieldset
                  className="grid gap-4 border-b border-border p-4"
                  disabled={formDisabled}
                >
                  <div className="grid gap-2">
                    <span className="text-sm font-bold">
                      游戏语言 <span className="text-accent">*</span>
                    </span>
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
                    <Notice
                      tone="error"
                      className="border p-3 text-sm"
                      role="alert"
                    >
                      {submitError}
                    </Notice>
                  ) : null}
                  {upload.task?.commitStarted && !upload.task.result ? (
                    <p className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                      正在提交，资料已锁定，当前不能取消或离开页面。
                    </p>
                  ) : null}
                  {uploadResult ? (
                    <Button
                      className="min-h-12 w-full"
                      disabled
                      type="button"
                      variant="rm2k"
                    >
                      上传完成
                    </Button>
                  ) : archiveMode && upload.metadataConfirmed ? (
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
                      disabled={
                        preparing || Boolean(initialWork && !editSourceReady)
                      }
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

function ExternalSourceSection({
  disabled,
  onChange,
  value,
}: {
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

function ReadinessList({
  archiveMode,
  existingArchive,
  metadataConfirmed,
  preparing,
  sourceSummary,
  task,
}: {
  archiveMode: boolean;
  existingArchive: {
    name: string;
    fileCount: number;
    sizeBytes: number;
  } | null;
  metadataConfirmed: boolean;
  preparing: boolean;
  sourceSummary: { name: string; fileCount: number; sizeBytes: number } | null;
  task: BrowserUploadTaskSnapshot | null;
}) {
  const items = archiveMode
    ? [
        {
          label: "游戏文件",
          value:
            existingArchive || task?.sourceReady
              ? "已就绪"
              : task
                ? uploadPhaseLabel(task.phase)
                : sourceSummary
                  ? "准备中"
                  : "尚未选择",
          tone:
            existingArchive || task?.sourceReady
              ? "ready"
              : task
                ? "running"
                : "idle",
        },
        {
          label: "作品资料",
          value: task?.commitStarted
            ? "已锁定"
            : metadataConfirmed
              ? "已确认"
              : "编辑中",
          tone: metadataConfirmed ? "ready" : "idle",
        },
        {
          label: "发布",
          value: task?.result
            ? "已完成"
            : task?.commitStarted
              ? uploadPhaseLabel(task.phase)
              : task?.sourceReady && !metadataConfirmed
                ? "等待作品资料"
                : !task?.sourceReady && metadataConfirmed
                  ? "等待游戏文件"
                  : "等待两项就绪",
          tone: task?.result
            ? "ready"
            : task?.commitStarted
              ? "running"
              : "idle",
        },
      ]
    : [
        {
          label: "作品资料",
          value: preparing ? "正在发布" : "编辑中",
          tone: preparing ? "running" : "idle",
        },
        {
          label: "发布",
          value: preparing ? "提交中" : "等待发布",
          tone: preparing ? "running" : "idle",
        },
      ];
  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <div
          className="grid grid-cols-[10px_minmax(0,1fr)] items-start gap-2.5"
          key={item.label}
        >
          <span
            className={cn(
              "mt-1.5 size-2.5 rounded-full bg-muted/40",
              item.tone === "ready" && "bg-emerald-500",
              item.tone === "running" && "animate-pulse bg-primary",
            )}
          />
          <span>
            <strong className="block text-sm">{item.label}</strong>
            <span className="block text-xs text-muted">{item.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function newTranslator(
  user: Pick<CurrentUser, "id" | "displayName">,
): CreatorSelection {
  return {
    kind: "new",
    name: user.displayName,
    displayName: user.displayName,
    sourceUserId: user.id,
  };
}

function translatorStaff(
  form: FlatMetadata,
  defaults: UploadStaffCredit[] = [],
): WorkStaffCredit[] {
  if (!form.isTranslation) return [];
  const existing = new Map(
    defaults.map((credit) => [creatorSelectionKey(credit.selection), credit]),
  );
  return form.translators.filter(
    (selection): selection is CreatorSelection => selection !== null,
  ).map((selection) => {
    if (!selection?.displayName.trim()) throw new Error("请填写译者。");
    const credit = existing.get(creatorSelectionKey(selection));
    return {
      selection,
      roleKey: "translator",
      roleLabel: credit?.roleLabel ?? null,
      notes: credit?.notes ?? null,
    };
  });
}

function initialForm(
  canArchiveUpload: boolean,
  user: CurrentUser,
  initialWork: UploadInitialWork | null,
): FlatMetadata {
  if (initialWork) {
    return {
      originalTitle: initialWork.originalTitle,
      chineseTitle: initialWork.chineseTitle ?? "",
      aliasTitles: initialWork.aliases,
      engineFamily: initialWork.engineFamily,
      description: initialWork.description ?? "",
      genre: initialWork.genre ?? "",
      tags: initialWork.tags,
      characters: initialWork.characters,
      authors: initialWork.authors.length
        ? initialWork.authors.map((credit) => credit.selection)
        : [null],
      extraStaff: staffRows(initialWork.extraStaff),
      moreInfo: moreInfoRows(initialWork.moreInfo),
      translators: initialWork.translators.map((credit) => credit.selection),
      originalReleaseDate: initialWork.originalReleaseDate ?? "",
      isOriginal: initialWork.isOriginal,
      isTranslation: initialWork.isTranslation,
      usesUnsupportedManiac: initialWork.usesUnsupportedManiac,
      language: initialWork.language,
      archiveSourceUrl: initialWork.archiveSourceUrl ?? "",
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
    genre: "",
    tags: [],
    characters: [],
    authors: [null],
    extraStaff: [],
    moreInfo: [],
    translators: [newTranslator(user)],
    originalReleaseDate: "",
    isOriginal: false,
    isTranslation: false,
    usesUnsupportedManiac: false,
    language: "zh-CN",
    archiveSourceUrl: "",
    externalDownloadUrl: "",
    status: "published",
  };
}

function associationsFromMetadata(
  metadata: ArchiveCommitMetadata,
): AssociationDefaults {
  return {
    characters: metadata.characters ?? [],
    authors: metadata.workStaff.filter((staff) => staff.roleKey === "author"),
    translators: metadata.workStaff.filter(
      (staff) => staff.roleKey === "translator",
    ),
  };
}

function formFromMetadata(metadata: ArchiveCommitMetadata): FlatMetadata {
  const authors = metadata.workStaff.filter(
    (staff) => staff.roleKey === "author",
  );
  return {
    originalTitle: metadata.game.originalTitle,
    chineseTitle: metadata.game.chineseTitle ?? "",
    aliasTitles: uniqueTokens(metadata.workTitles.map((item) => item.title)),
    engineFamily: metadata.game.engineFamily,
    description: metadata.game.description ?? "",
    genre: metadata.game.genre ?? "",
    tags: metadata.tags,
    characters: (metadata.characters ?? []).map(
      ({ selection, roleKey, portrait, faceSheetBlobSha256s }) => ({
        selection,
        roleKey,
        portrait,
        faceSheetBlobSha256s,
      }),
    ),
    authors: authors.length
      ? authors.map((credit) => credit.selection)
      : [null],
    extraStaff: staffRows(
      metadata.workStaff.filter(
        (staff) => staff.roleKey !== "author" && staff.roleKey !== "translator",
      ),
    ),
    moreInfo: moreInfoRows(normalizeWorkMoreInfo(metadata.game.extra.moreInfo)),
    translators: metadata.workStaff
      .filter((staff) => staff.roleKey === "translator")
      .map((staff) => staff.selection),
    originalReleaseDate: metadata.game.originalReleaseDate ?? "",
    isOriginal: metadata.game.isOriginal,
    isTranslation: metadata.game.isTranslation,
    usesUnsupportedManiac:
      metadata.game.engineFamily === "rpg_maker_2003_maniac" &&
      metadata.game.extra.usesUnsupportedManiac === true,
    language: metadata.game.language,
    archiveSourceUrl: metadata.archiveVersion.sourceUrl ?? "",
    externalDownloadUrl: "",
    status: metadata.game.status === "hidden" ? "hidden" : "published",
  };
}

function buildMetadata(
  form: FlatMetadata,
  imageHashes: { coverBlobSha256: string; previewBlobSha256s: string[] },
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
    const resolved = withCharacterFaceSheetHashes(
      credit,
      index,
      faceSheetHashes,
    );
    return {
      selection,
      portrait: resolved.portrait,
      faceSheetBlobSha256s: resolved.faceSheetBlobSha256s,
      roleKey: credit.roleKey,
      spoilerLevel: existing?.spoilerLevel ?? 0,
      sortOrder: index + 1,
      notes: existing?.notes ?? null,
    } satisfies CharacterCredit;
  });
  const authorDefaults = new Map(
    defaults.authors.map((staff) => [
      creatorSelectionKey(staff.selection),
      staff,
    ]),
  );
  const authorStaff = form.authors
    .filter((value): value is CreatorSelection => value !== null)
    .map((selection) => ({
      selection,
      roleKey: "author" as const,
      roleLabel:
        authorDefaults.get(creatorSelectionKey(selection))?.roleLabel ?? "作者",
      notes: authorDefaults.get(creatorSelectionKey(selection))?.notes ?? null,
    }));
  return {
    game: {
      originalTitle: form.originalTitle.trim(),
      chineseTitle: cleanNullable(form.chineseTitle),
      description: cleanNullable(form.description),
      genre: normalizeWorkGenre(form.genre) ?? null,
      originalReleaseDate: releaseDate.value,
      originalReleasePrecision: releaseDate.precision,
      engineFamily: form.engineFamily,
      isOriginal: form.isOriginal,
      isTranslation: form.isTranslation,
      language: form.language,
      ...imageHashes,
      status: form.status,
      extra: {
        moreInfo: normalizeWorkMoreInfo(form.moreInfo),
        usesUnsupportedManiac:
          form.engineFamily === "rpg_maker_2003_maniac" && form.usesUnsupportedManiac,
      },
    },
    target: { mode: targetWorkId ? "update" : "create", workId: targetWorkId },
    archiveVersion: {
      sourceName: null,
      sourceUrl: cleanNullable(form.archiveSourceUrl),
    },
    workTitles: uniqueTokens(form.aliasTitles).map((title) => ({
      title,
      language: null,
      titleType: "alias",
    })),
    characters,
    workStaff: [
      ...authorStaff,
      ...extraStaffCredits(form.extraStaff),
      ...translatorStaff(form, defaults.translators),
    ],
    tags: uniqueTokens(form.tags),
  };
}

async function prepareSelectedImages(
  input: ImageSelections,
  retained: UploadInitialWork | null = null,
): Promise<PreparedImages> {
  const blobs: MetadataBlobUpload[] = [];
  const coverBlobSha256 = input.cover ? await prepareMetadataImage(input.cover, blobs) : retained?.coverBlobSha256 ?? "";
  if (!coverBlobSha256) throw new Error("请指定封面图。");
  const previewBlobSha256s = input.replacePreviews
    ? await Promise.all((input.previewOrder ?? input.browsingImages.map((_, index) => index)).map((entry) => typeof entry === "string" ? entry : prepareMetadataImage(input.browsingImages[entry], blobs)))
    : retained?.previewBlobSha256s ?? [];
  return { hashes: { coverBlobSha256, previewBlobSha256s }, blobs: uniqueMetadataBlobs(blobs) };
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

async function prepareMetadataImage(
  file: File,
  blobs: MetadataBlobUpload[],
): Promise<string> {
  if (!file.type.startsWith("image/"))
    throw new Error(`${file.name} 不是图片文件。`);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const sha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  blobs.push({ sha256, file, contentType: file.type });
  return sha256;
}

async function submitExternalWork(
  form: FlatMetadata,
  images: ImageSelections,
  faceSheets: PreparedCharacterFaceSheets,
): Promise<{ workId: number; translators: ConfirmedCreatorSelection[] }> {
  if (!images.cover) throw new Error("外链作品必须提供封面图。");
  const body = new FormData();
  body.set("more_info", JSON.stringify(normalizeWorkMoreInfo(form.moreInfo)));
  body.set("original_title", form.originalTitle.trim());
  body.set("chinese_title", form.chineseTitle.trim());
  body.set("description", form.description.trim());
  body.set("genre", normalizeWorkGenre(form.genre) ?? "");
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
  body.set("authors", JSON.stringify(form.authors.filter(Boolean)));
  body.set("extra_staff", JSON.stringify(extraStaffCredits(form.extraStaff)));
  body.set(
    "translators",
    JSON.stringify(translatorStaff(form).map((staff) => staff.selection)),
  );
  body.set("download_url", form.externalDownloadUrl.trim());
  body.set("cover", images.cover);
  for (const image of images.browsingImages)
    body.append("browsing_images[]", image);
  for (const faceSheet of faceSheets.blobs) {
    body.append("character_face_sheets[]", faceSheet.file);
  }
  const response = await fetch("/api/works/external", {
    method: "POST",
    body,
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    workId?: number;
    translators: ConfirmedCreatorSelection[];
    detail?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok || !payload.workId)
    throw new Error(payload?.detail || payload?.error || "发布外链作品失败。");
  return { workId: payload.workId, translators: payload.translators };
}

async function submitOwnedWork(
  workId: number,
  distribution: "archive" | "external",
  form: FlatMetadata,
  images: ImageSelections,
  faceSheets: PreparedCharacterFaceSheets,
): Promise<ConfirmedCreatorSelection[]> {
  const body = new FormData();
  body.set("more_info", JSON.stringify(normalizeWorkMoreInfo(form.moreInfo)));
  body.set("distribution", distribution);
  body.set("original_title", form.originalTitle.trim());
  body.set("chinese_title", form.chineseTitle.trim());
  body.set("description", form.description.trim());
  body.set("genre", normalizeWorkGenre(form.genre) ?? "");
  body.set("original_release_date", form.originalReleaseDate.trim());
  body.set("engine_family", form.engineFamily);
  if (form.isOriginal) body.set("is_original", "1");
  if (form.isTranslation) body.set("is_translation", "1");
  body.set("language", form.language);
  body.set("status", form.status);
  if (form.engineFamily === "rpg_maker_2003_maniac" && form.usesUnsupportedManiac) {
    body.set("uses_unsupported_maniac", "1");
  }
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
  body.set("authors", JSON.stringify(form.authors.filter(Boolean)));
  body.set("extra_staff", JSON.stringify(extraStaffCredits(form.extraStaff)));
  body.set(
    "translators",
    JSON.stringify(translatorStaff(form).map((staff) => staff.selection)),
  );
  body.set(
    "download_url",
    distribution === "external" ? form.externalDownloadUrl.trim() : "",
  );
  if (images.cover) body.set("cover", images.cover);
  if (images.replacePreviews) {
    body.set("replace_previews", "1");
    if (images.previewOrder) body.set("preview_order", JSON.stringify(images.previewOrder));
    for (const image of images.browsingImages) body.append("browsing_images[]", image);
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
    translators: ConfirmedCreatorSelection[];
    detail?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.detail || payload?.error || "作品资料保存失败。");
  }
  return payload.translators;
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

function uniqueMetadataBlobs(
  blobs: MetadataBlobUpload[],
): MetadataBlobUpload[] {
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

function cleanNullable(value: string): string | null {
  return value.trim() || null;
}
function uniqueTokens(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
