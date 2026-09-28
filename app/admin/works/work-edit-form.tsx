import { CoverPicker } from "@/app/components/media/media-picker";
import { Input } from "@/app/components/ui/input";
import { Pane } from "@/app/components/ui/pane";
import { SelectField } from "@/app/components/ui/select";
import { useToast } from "@/app/components/ui/toast";
import { LanguageField } from "@/app/components/work/language-field";
import { WorkMetadataFields } from "@/app/components/work/work-metadata-fields";
import { moreInfoRows } from "@/app/components/work/work-more-info-editor";
import { EnginePicker } from "@/app/upload/engine-picker";
import { extraStaffCredits, staffRowErrors, staffRows } from "@/app/upload/staff-editor";
import type { UploadFormMetadata, UploadImageSelections } from "@/app/upload/upload-types";
import { WorkbenchField } from "@/app/upload/workbench-field";
import type { AdminWorkEdit } from "@/lib/dto/db/game-library";
import { creatorSelectionKey, type CreatorSelection } from "@/lib/creator-names";
import type { StaffCredit } from "@/lib/staff-credits";
import { isExtraStaffRole } from "@/lib/staff-credits";
import { normalizeWorkMoreInfo } from "@/lib/work-more-info";
import { useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { ExternalLinkList } from "./structured-work-fields";

export function WorkEditForm({ work, suggestions, canUpdateStatus, children }: {
  work: AdminWorkEdit;
  suggestions: ComponentProps<typeof WorkMetadataFields>["suggestions"];
  canUpdateStatus: boolean;
  children: ReactNode;
}) {
  const credits: StaffCredit[] = work.creators.map((creator) => ({
    selection: { kind: "existing", creatorId: creator.id, name: creator.name, displayName: creator.displayName },
    roleKey: creator.roleKey as StaffCredit["roleKey"], roleLabel: creator.roleLabel, notes: creator.notes,
  }));
  const [form, setForm] = useState<UploadFormMetadata>(() => ({
    originalTitle: work.originalTitle,
    chineseTitle: work.chineseTitle ?? "",
    description: work.description ?? "",
    genre: work.genre ?? "",
    originalReleaseDate: work.originalReleaseDate ?? "",
    engineFamily: work.engineFamily as UploadFormMetadata["engineFamily"],
    isOriginal: work.isOriginal,
    isTranslation: work.isTranslation,
    usesUnsupportedManiac: work.usesUnsupportedManiac,
    language: work.language,
    aliasTitles: work.aliases,
    tags: work.tags,
    characters: work.characters,
    moreInfo: moreInfoRows(work.moreInfo),
    authors: credits.filter((credit) => credit.roleKey === "author").map((credit) => credit.selection),
    translators: credits.filter((credit) => credit.roleKey === "translator").map((credit) => credit.selection),
    extraStaff: staffRows(credits.filter((credit) => isExtraStaffRole(credit.roleKey))),
    archiveSourceUrl: "", externalDownloadUrl: "", status: "hidden",
  }));
  const [images, setImages] = useState<UploadImageSelections>({ cover: null, browsingImages: [], replacePreviews: false });
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const busyRef = useRef(false);
  const toast = useToast();
  const coverHash = work.media.find((media) => media.role === "cover")?.blobSha256 ?? "";
  const previewHashes = work.media.filter((media) => media.role === "preview")
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((media) => media.blobSha256);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const body = new FormData(event.currentTarget);
    busyRef.current = true;
    setBusy(true);
    try {
      setShowErrors(true);
      const staffError = staffRowErrors(form.extraStaff).find(Boolean);
      if (staffError) throw new Error(staffError.message);
      body.set("work_id", String(work.id));
      body.set("chinese_title", form.chineseTitle);
      body.set("description", form.description);
      body.set("genre", form.genre);
      body.set("original_release_date", form.originalReleaseDate);
      body.set("engine_family", form.engineFamily);
      body.set("language", form.language);
      if (form.isOriginal) body.set("is_original", "1");
      if (form.isTranslation) body.set("is_translation", "1");
      if (form.usesUnsupportedManiac) body.set("uses_unsupported_maniac", "1");
      body.set("aliases", form.aliasTitles.join("\n"));
      body.set("tags", form.tags.join("\n"));
      body.set("characters", JSON.stringify(form.characters));
      // Keep stored role labels and notes when the shared person picker changes a credit.
      const primaryCredits = (selections: (CreatorSelection | null)[], roleKey: "author" | "translator"): StaffCredit[] =>
        selections.filter((selection): selection is CreatorSelection => selection !== null).map((selection) => {
          const existing = credits.find((credit) => credit.roleKey === roleKey && creatorSelectionKey(credit.selection) === creatorSelectionKey(selection));
          return { selection, roleKey, roleLabel: existing?.roleLabel ?? null, notes: existing?.notes ?? null };
        });
      body.set("work_staff", JSON.stringify([
        ...primaryCredits(form.authors, "author"),
        ...primaryCredits(form.isTranslation ? form.translators : [], "translator"),
        ...extraStaffCredits(form.extraStaff),
      ]));
      body.set("more_info", JSON.stringify(normalizeWorkMoreInfo(form.moreInfo)));
      if (images.cover) body.set("cover", images.cover);
      if (images.replacePreviews) {
        body.set("replace_previews", "1");
        if (images.previewOrder) body.set("preview_order", JSON.stringify(images.previewOrder));
        for (const image of images.browsingImages) body.append("browsing_images[]", image);
      }
      const response = await fetch(`/api/admin/works/${work.id}/update`, {
        method: "POST", body, credentials: "same-origin", headers: { Accept: "application/json" },
      });
      const result = await response.json() as { ok?: boolean; detail?: string; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.detail || result.error || "作品资料保存失败。");
      window.location.assign(`/admin/works/${work.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "作品资料保存失败。");
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
      <fieldset className="grid min-w-0 gap-4" disabled={busy}>
        <Pane>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="grid min-w-0 gap-5">
              <WorkbenchField label="引擎">
                <EnginePicker value={form.engineFamily} disabled={busy} onValueChange={(engineFamily) => setForm((current) => ({ ...current, engineFamily }))} />
              </WorkbenchField>
              <WorkbenchField label="语言">
                <LanguageField value={form.language} onValueChange={(language) => setForm((current) => ({ ...current, language }))} />
              </WorkbenchField>
              <WorkMetadataFields
                originalTitleReadOnly
                originalDeclarationLabel="本站原创"
                showArchiveSource={false}
                changeCharacters={(characters) => setForm((current) => ({ ...current, characters }))}
                changeOriginalDeclaration={(isOriginal) => setForm((current) => ({ ...current, isOriginal, isTranslation: isOriginal ? false : current.isTranslation }))}
                changeTranslationDeclaration={(isTranslation) => setForm((current) => ({ ...current, isTranslation, isOriginal: isTranslation ? false : current.isOriginal }))}
                changeTranslator={(translators) => setForm((current) => ({ ...current, translators }))}
                disabled={busy}
                existingPreviewHashes={previewHashes}
                existingImageBaseUrl={`/api/works/${work.id}/media/`}
                form={form}
                setForm={setForm}
                imageSelections={images}
                setImageSelections={setImages}
                suggestions={suggestions}
                translatorError={null}
                staffErrorsVisible={showErrors}
                moreInfoErrorsVisible={showErrors}
              />
            </div>
            <div className="min-w-0">
              <CoverPicker disabled={busy} existingCoverBlobSha256={coverHash} existingBlobSha256s={previewHashes}
                existingImageBaseUrl={`/api/works/${work.id}/media/`} file={images.cover}
                onChange={(cover) => setImages((current) => ({ ...current, cover }))} />
            </div>
          </div>
        </Pane>
        <Pane heading="管理设置">
          <div className="grid gap-4">
            {canUpdateStatus ? <WorkbenchField controlId="admin-work-status" label="状态">
              <SelectField id="admin-work-status" aria-label="状态" name="status" defaultValue={work.status} options={[
                { value: "published", label: "已发布" }, { value: "hidden", label: "隐藏" }, { value: "deleted", label: "已删除（仅后台可见）" },
              ]} />
            </WorkbenchField> : null}
            <ExternalLinkList initialValues={work.externalLinks} />
            <details>
              <summary className="cursor-pointer text-sm font-bold">已上传封面引用</summary>
              <div className="mt-3 grid gap-4">
                <p className="text-sm text-muted">选择新封面后，将优先使用新图片。</p>
                <WorkbenchField controlId="admin-cover-hash" label="封面 SHA-256">
                  <Input id="admin-cover-hash" name="cover_blob_sha256" defaultValue={coverHash} pattern="[a-fA-F0-9]{64}" disabled={Boolean(images.cover)} />
                </WorkbenchField>
                <input type="hidden" name="preview_blob_sha256s" value={previewHashes.join("\n")} />
              </div>
            </details>
          </div>
        </Pane>
        {children}
      </fieldset>
    </form>
  );
}
