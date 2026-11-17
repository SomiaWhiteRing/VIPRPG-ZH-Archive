import { WorkGenreInput } from "@/app/components/work/work-genre-input";
import { CharacterPicker } from "@/app/components/characters/character-picker";
import { PreviewPicker } from "@/app/components/media/preview-picker";
import { CreatorTokenPicker } from "@/app/components/pickers/creator-token-picker";
import { TokenPicker } from "@/app/components/pickers/token-picker";
import { Checkbox } from "@/app/components/ui/checkbox";
import { CustomSelect } from "@/app/components/ui/custom-select";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PrecisionDatePicker } from "@/app/components/ui/precision-date-picker";
import { Textarea } from "@/app/components/ui/textarea";
import { WorkMoreInfoEditor } from "@/app/components/work/work-more-info-editor";
import { StaffEditor } from "@/app/upload/staff-editor";
import { UploadTagPicker } from "@/app/upload/upload-tag-picker";
import type { SourceFaceSheetWarning, UploadFormMetadata as FlatMetadata, UploadImageSelections as ImageSelections, UploadSuggestions } from "@/app/upload/upload-types";
import { WorkbenchField } from "@/app/upload/workbench-field";
import type { CharacterCreditSelection } from "@/lib/character-names";
import type { CreatorSelection } from "@/lib/creator-names";
import { isArchiveEngineFamily } from "@/lib/labels";
import { MAX_PUBLIC_TAGS } from "@/lib/user-tags";
import { constrainWorkVisibility } from "@/lib/work-visibility";
import { WORK_REFERENCE_DURATIONS, WORK_REFERENCE_DURATION_MAX_LENGTH } from "@/lib/work-reference-duration";
import type { MessageKey } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";

const durationMessageKeys = {
  "nnkr（~5min）": "upload.metadata.duration.nnkr",
  "短篇（~30min）": "upload.metadata.duration.short",
  "中篇（~2h）": "upload.metadata.duration.medium",
  "长篇（~10h）": "upload.metadata.duration.long",
  "巨作（10h+）": "upload.metadata.duration.epic",
} satisfies Record<(typeof WORK_REFERENCE_DURATIONS)[number], MessageKey>;

export function WorkMetadataFields({
  originalTitleReadOnly = false,
  originalDeclarationLabel,
  showArchiveSource = true,
  showUploadTagGuidance = false,
  archiveSourceDisabled,
  characterFaceSheetFiles,
  sourceFaceSheetFiles,
  sourceFaceSheetWarnings,
  sourceFaceSheetsLoading,
  changeCharacterFaceSheetFiles,
  changeCharacters,
  changeOriginalDeclaration,
  changeTranslationDeclaration,
  changeTranslator,
  disabled,
  existingPreviewHashes,
  existingImageBaseUrl = "/api/media/blobs/",
  form,
  imageSelections,
  removeCharacterFaceSheetFiles,
  setForm,
  setImageSelections,
  suggestions,
  translatorError,
  staffErrorsVisible,
  moreInfoErrorsVisible,
}: {
  originalTitleReadOnly?: boolean;
  originalDeclarationLabel?: string;
  showArchiveSource?: boolean;
  showUploadTagGuidance?: boolean;
  archiveSourceDisabled?: boolean;
  characterFaceSheetFiles?: Record<number, File[]>;
  sourceFaceSheetFiles?: File[];
  sourceFaceSheetWarnings?: SourceFaceSheetWarning[];
  sourceFaceSheetsLoading?: boolean;
  changeCharacterFaceSheetFiles?: (index: number, files: File[]) => void;
  changeCharacters: (
    characters: CharacterCreditSelection[],
    reorderedIndices?: number[],
  ) => void;
  changeOriginalDeclaration: (checked: boolean) => void;
  changeTranslationDeclaration: (checked: boolean) => void;
  changeTranslator: (value: (CreatorSelection | null)[]) => void;
  disabled: boolean;
  existingPreviewHashes: string[];
  existingImageBaseUrl?: string;
  form: FlatMetadata;
  imageSelections: ImageSelections;
  removeCharacterFaceSheetFiles?: (index: number) => void;
  setForm: Dispatch<SetStateAction<FlatMetadata>>;
  setImageSelections: Dispatch<SetStateAction<ImageSelections>>;
  suggestions: UploadSuggestions;
  translatorError: string | null;
  staffErrorsVisible: boolean;
  moreInfoErrorsVisible: boolean;
}) {
  const t = useMessages();
  const referenceDurationOptions = [
    { value: "none", label: t("upload.metadata.none") },
    ...WORK_REFERENCE_DURATIONS.map((value) => ({ value, label: t(durationMessageKeys[value]) })),
    { value: "custom", label: t("upload.metadata.custom") },
  ];
  const moreSettingsRef = useRef<HTMLDetailsElement>(null);
  const hasStaff = form.extraStaff.length > 0;
  const hasMoreInfo = form.moreInfo.length > 0;
  const filledMoreInfoCount = form.moreInfo.filter(
    (item) => item.title.trim() && item.body.trim(),
  ).length;
  const filledStaffCount = form.extraStaff.filter(
    (row) =>
      row.roleKey &&
      row.selection?.displayName.trim() &&
      (row.roleKey !== "other" || row.roleLabel.trim()),
  ).length;
  useEffect(() => {
    if ((hasStaff || hasMoreInfo) && moreSettingsRef.current)
      moreSettingsRef.current.open = true;
  }, [hasStaff, hasMoreInfo]);
  return (
    <div>
      <h2 className="mb-4 text-lg font-bold">{t("upload.details")}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <WorkbenchField controlId="upload-chinese-title" label={t("upload.metadata.chineseTitle")}>
          <Input
            disabled={disabled}
            id="upload-chinese-title"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                chineseTitle: event.target.value,
              }))
            }
            value={form.chineseTitle}
          />
        </WorkbenchField>
        <WorkbenchField controlId="upload-original-title" label={t("upload.metadata.originalTitle")} required={!originalTitleReadOnly} info={originalTitleReadOnly ? t("upload.metadata.originalReadOnly") : undefined}>
          <Input
            disabled={disabled}
            id="upload-original-title"
            readOnly={originalTitleReadOnly}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                originalTitle: event.target.value,
              }))
            }
            required
            value={form.originalTitle}
          />
        </WorkbenchField>
        <div className="grid min-w-0 grid-cols-2 gap-4 md:col-span-2">
          <WorkbenchField controlId="upload-genre" label={t("upload.metadata.genre")}>
            <WorkGenreInput
              disabled={disabled}
              id="upload-genre"
              onChange={(genre) => setForm((current) => ({ ...current, genre }))}
              value={form.genre}
            />
          </WorkbenchField>
          <WorkbenchField controlId="upload-reference-duration" label={t("upload.metadata.duration")}>
            <CustomSelect
              id="upload-reference-duration"
              label={t("upload.metadata.duration")}
              options={referenceDurationOptions}
              value={form.referenceDurationCustom ? "custom" : form.referenceDuration}
              customValue={form.referenceDuration}
              customOption="custom"
              placeholder=""
              disabled={disabled}
              maxLength={WORK_REFERENCE_DURATION_MAX_LENGTH}
              onChange={(value, customValue) => setForm((current) => ({
                ...current,
                referenceDuration: value === "custom" ? customValue : value === "none" ? "" : value,
                referenceDurationCustom: value === "custom",
              }))}
            />
          </WorkbenchField>
        </div>
        <WorkbenchField controlId="upload-author" label={t("upload.metadata.author")}>
          <CreatorTokenPicker
            disabled={disabled}
            id="upload-author"
            role="author"
            onChange={(authors) =>
              setForm((current) => ({ ...current, authors }))
            }
            suggestions={suggestions.creators}
            values={form.authors.filter(
              (value): value is CreatorSelection => value !== null,
            )}
          />
        </WorkbenchField>
        {form.isTranslation ? (
          <WorkbenchField controlId="upload-translator" label={t("upload.metadata.translator")}>
            <div className="grid gap-1.5">
              <CreatorTokenPicker
                disabled={disabled}
                errorId={
                  translatorError ? "upload-translator-error" : undefined
                }
                id="upload-translator"
                invalid={Boolean(translatorError)}
                role="translator"
                onChange={changeTranslator}
                suggestions={suggestions.creators}
                values={form.translators.filter(
                  (value): value is CreatorSelection => value !== null,
                )}
              />
              {translatorError ? (
                <p
                  className="text-sm text-red-700 dark:text-red-300"
                  id="upload-translator-error"
                  role="alert"
                >
                  {translatorError}
                </p>
              ) : null}
            </div>
          </WorkbenchField>
        ) : null}
        <WorkbenchField
          className="md:col-span-2"
          controlId="upload-release-date"
          label={t("upload.metadata.published")}
        >
          <PrecisionDatePicker
            disabled={disabled}
            id="upload-release-date"
            onChange={(value) =>
              setForm((current) => ({ ...current, originalReleaseDate: value }))
            }
            placeholder={t("upload.metadata.publishedHint")}
            value={form.originalReleaseDate}
          />
        </WorkbenchField>
        <WorkbenchField
          className="md:col-span-2"
          label={<span id="upload-declarations-label">{t("upload.metadata.declarations")}</span>}
        >
          <div
            aria-labelledby="upload-declarations-label"
            className="flex flex-wrap gap-x-5 gap-y-3 py-2.5"
            role="group"
          >
            <Label
              className="flex w-fit items-center gap-2 text-sm text-red-700 dark:text-red-300"
              htmlFor="upload-is-original"
            >
              <Checkbox
                checked={form.isOriginal}
                className="data-[state=checked]:border-red-700 data-[state=checked]:bg-red-700 dark:data-[state=checked]:border-red-400 dark:data-[state=checked]:bg-red-400"
                disabled={disabled}
                id="upload-is-original"
                onCheckedChange={(checked) =>
                  changeOriginalDeclaration(checked === true)
                }
              />
              {originalDeclarationLabel ?? t("upload.metadata.originalDeclaration")}
            </Label>
            <Label
              className="flex w-fit items-center gap-2 text-sm"
              htmlFor="upload-is-translation"
            >
              <Checkbox
                checked={form.isTranslation}
                disabled={disabled}
                id="upload-is-translation"
                onCheckedChange={(checked) =>
                  changeTranslationDeclaration(checked === true)
                }
              />
              {t("upload.metadata.translation")}
            </Label>
            {form.engineFamily === "rpg_maker_2003_maniac" ? (
              <Label
                className="flex w-fit items-center gap-2 text-sm"
                htmlFor="upload-unsupported-maniac"
              >
                <Checkbox
                  checked={form.usesUnsupportedManiac}
                  disabled={disabled}
                  id="upload-unsupported-maniac"
                  onCheckedChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      usesUnsupportedManiac: checked === true,
                    }))
                  }
                />
                {t("upload.metadata.maniac")}
              </Label>
            ) : null}
          </div>
        </WorkbenchField>
        <WorkbenchField
          className="md:col-span-2"
          controlId="upload-description"
          label={t("upload.metadata.description")}
        >
          <Textarea
            className="min-h-32 resize-y overflow-auto"
            disabled={disabled}
            id="upload-description"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            rows={4}
            value={form.description}
          />
        </WorkbenchField>
        <WorkbenchField
          className="md:col-span-2"
          controlId="upload-tags"
          label={t("upload.metadata.tags")}
        >
          {showUploadTagGuidance ? <UploadTagPicker
            disabled={disabled}
            suggestions={suggestions.tags}
            values={form.tags}
            onChange={(tags) => setForm((current) => ({ ...current, tags, ...constrainWorkVisibility(current, tags) }))}
          /> : <TokenPicker
            disabled={disabled}
            id="upload-tags"
            label={t("upload.metadata.tags")}
            maxValues={MAX_PUBLIC_TAGS}
            onChange={(tags) => setForm((current) => ({ ...current, tags, ...constrainWorkVisibility(current, tags) }))}
            placeholder={t("upload.metadata.tagSearch")}
            recommendationLabel={t("upload.metadata.tagRecommendations")}
            sortable
            suggestions={suggestions.tags}
            values={form.tags}
          />}
        </WorkbenchField>
        <WorkbenchField
          className="md:col-span-2"
          controlId="upload-characters"
          label={t("upload.metadata.characters")}
        >
          <CharacterPicker
            characterIndex={suggestions.characterIndex}
            disabled={disabled}
            faceSheetFiles={characterFaceSheetFiles}
            sourceFaceSheetFiles={sourceFaceSheetFiles}
            sourceFaceSheetWarnings={sourceFaceSheetWarnings}
            sourceFaceSheetsLoading={sourceFaceSheetsLoading}
            id="upload-characters"
            onChange={changeCharacters}
            onFaceSheetFilesChange={changeCharacterFaceSheetFiles}
            onFaceSheetFilesRemove={removeCharacterFaceSheetFiles}
            suggestions={suggestions.characters}
            values={form.characters}
          />
        </WorkbenchField>
        <details
          className="md:col-span-2"
          id="upload-more-settings"
          ref={moreSettingsRef}
        >
          <summary className="cursor-pointer py-1 text-sm font-bold">
            {t("upload.metadata.moreSettings")}
            {filledStaffCount > 0 ? (
              <span className="ml-2 text-xs font-normal text-muted">
                {t("upload.metadata.staffCount", { count: filledStaffCount })}
              </span>
            ) : null}
            {filledMoreInfoCount > 0 ? (
              <span className="ml-2 text-xs font-normal text-muted">
                {t("upload.metadata.infoCount", { count: filledMoreInfoCount })}
              </span>
            ) : null}
          </summary>
          <div className="mt-3 grid gap-4 border-t border-border pt-4">
            <WorkbenchField label={t("upload.metadata.previews")}>
              <PreviewPicker
                disabled={disabled}
                existingHashes={imageSelections.replacePreviews ? [] : existingPreviewHashes}
                imageBaseUrl={existingImageBaseUrl}
                order={imageSelections.previewOrder}
                files={imageSelections.browsingImages}
                onChange={(browsingImages, previewOrder) =>
                  setImageSelections((current) => ({
                    ...current,
                    browsingImages,
                    previewOrder,
                    replacePreviews: true,
                  }))
                }
              />
            </WorkbenchField>
            <WorkbenchField controlId="upload-aliases" label={t("upload.metadata.aliases")}>
              <TokenPicker
                disabled={disabled}
                id="upload-aliases"
                label={t("upload.metadata.aliases")}
                onChange={(aliasTitles) =>
                  setForm((current) => ({ ...current, aliasTitles }))
                }
                placeholder={t("upload.metadata.aliasInput")}
                showRecommendations={false}
                showSelectionCount={false}
                suggestions={[]}
                values={form.aliasTitles}
              />
            </WorkbenchField>
            {showArchiveSource && isArchiveEngineFamily(form.engineFamily) ? <WorkbenchField controlId="upload-source-url" label={t("upload.metadata.releaseUrl")}>
              <Input
                disabled={archiveSourceDisabled ?? disabled}
                id="upload-source-url"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    archiveSourceUrl: event.target.value,
                  }))
                }
                type="url"
                value={form.archiveSourceUrl}
              />
            </WorkbenchField> : null}
            <StaffEditor
              rows={form.extraStaff}
              disabled={disabled}
              suggestions={suggestions.creators}
              showErrors={staffErrorsVisible}
              onChange={(extraStaff) =>
                setForm((current) => ({ ...current, extraStaff }))
              }
            />
            <WorkMoreInfoEditor
              id="upload-more-info"
              rows={form.moreInfo}
              disabled={disabled}
              showErrors={moreInfoErrorsVisible}
              onChange={(moreInfo) =>
                setForm((current) => ({ ...current, moreInfo }))
              }
            />
          </div>
        </details>
      </div>
    </div>
  );
}
