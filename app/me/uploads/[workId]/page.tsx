import { requireAccountUser } from "@/app/.server/auth/account-user";
import { getOwnedWorkForEdit } from "@/app/.server/db/game-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { loadUploadSuggestions } from "@/app/.server/upload-suggestions";
import { BackLink } from "@/app/components/ui/back-link";
import { Button } from "@/app/components/ui/button";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { PageHeader } from "@/app/components/ui/page-header";
import type { UploadInitialWork } from "@/app/upload/upload-client";
import { UploadClient } from "@/app/upload/upload-client";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { UploaderWorkEdit } from "@/lib/dto/db/game-library";
import { isExtraStaffRole } from "@/lib/staff-credits";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const workId = parseId((await params).workId);
  const user = await requireAccountUser(runtime, `/me/uploads/${workId}`);
  if (!hasPermission(user, "work.update_own")) throwNotFound();
  const work = await getOwnedWorkForEdit(runtime, workId, user);
  if (!work) throwNotFound();
  const suggestions = await loadUploadSuggestions(runtime);

  return {
    user: pickPageFields(user, ["id", "displayName", "permissionKeys"]),
    work,
    suggestions,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: [
        loaderData?.work.chineseTitle || loaderData?.work.originalTitle || "作品",
        "编辑作品",
      ],
    },
    error,
  );

export default function UploadedWorkPage() {
  const { user, work, suggestions } = useLoaderData<typeof loader>();
  return (
    <div key={`${user.id}:${work.id}`} data-account-full-width>
      <PageHeader
        actions={<BackLink href="/me/uploads" label="返回我的上传" />}
        title={`编辑作品：${work.chineseTitle || work.originalTitle}`}
      />
      <UploadClient
        currentUser={{
          id: user.id,
          displayName: user.displayName,
          permissionKeys: user.permissionKeys,
        }}
        initialWork={{
          id: work.id,
          originalTitle: work.originalTitle,
          chineseTitle: work.chineseTitle,
          description: work.description,
          moreInfo: work.moreInfo,
          usesUnsupportedManiac: work.usesUnsupportedManiac,
          originalReleaseDate: work.originalReleaseDate,
          engineFamily: work.engineFamily as UploadInitialWork["engineFamily"],
          isOriginal: work.isOriginal,
          isTranslation: work.isTranslation,
          language: work.language,
          status: work.status as "published" | "hidden",
          aliases: work.aliases,
          tags: work.tags,
          characters: work.characters,
          characterCredits: work.characterCredits.map((character) => ({
            selection: {
              kind: "existing" as const,
              characterId: character.id,
              originalName: character.originalName,
              displayName: character.displayName,
            },
            portrait: character.portraitChoice,
            faceSheetBlobSha256s: [],
            roleKey: characterRole(character.roleKey),
            spoilerLevel: character.spoilerLevel,
            sortOrder: character.sortOrder ?? 0,
            notes: character.notes,
          })),
          authors: staffCredits(work, "author"),
          extraStaff: work.creators
            .filter((creator) => isExtraStaffRole(creator.roleKey))
            .map((creator) => ({
              selection: {
                kind: "existing" as const,
                creatorId: creator.id,
                name: creator.name,
                displayName: creator.displayName,
              },
              roleKey:
                creator.roleKey as UploadInitialWork["authors"][number]["roleKey"],
              roleLabel: creator.roleLabel,
              notes: creator.notes,
            })),
          translators: staffCredits(work, "translator"),
          externalDownloadUrl: work.externalDownloadUrl,
          archiveSourceUrl: work.currentArchive?.sourceUrl ?? null,
          coverBlobSha256: work.media.find((media) => media.role === "cover")?.blobSha256 ?? "",
          previewBlobSha256s: work.media
            .filter((media) => media.role === "preview")
            .sort(
              (left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0),
            )
            .map((media) => media.blobSha256),
          currentArchive: work.currentArchive
            ? {
                name: work.currentArchive.sourceName,
                fileCount: work.currentArchive.sourceFileCount,
                sizeBytes: work.currentArchive.sourceSizeBytes,
              }
            : null,
        }}
        suggestions={suggestions}
      />
      <ConfirmingForm
        action={`/api/works/${work.id}/delete`}
        className="mt-8"
        confirmField="confirm"
        title="确认删除作品？"
        description="删除后，作品将从公开页面和“我的上传”中移除，你将无法查看或修改。文件和资料会保留，只有管理员可以恢复。"
      >
        <input name="confirm" type="hidden" value="delete" />
        <Button type="submit" variant="destructive">
          删除作品
        </Button>
      </ConfirmingForm>
    </div>
  );
}

function staffCredits(
  work: UploaderWorkEdit,
  roleKey: "author" | "translator",
): UploadInitialWork["authors"] {
  return work.creators
    .filter((creator) => creator.roleKey === roleKey)
    .map((creator) => ({
      selection: {
        kind: "existing" as const,
        creatorId: creator.id,
        name: creator.name,
        displayName: creator.displayName,
      },
      roleKey,
      roleLabel: creator.roleLabel,
      notes: creator.notes,
    }));
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throwNotFound();
  return id;
}

function characterRole(
  value: string,
): "main" | "supporting" | "cameo" | "mentioned" | "other" {
  return value === "main" ||
    value === "cameo" ||
    value === "mentioned" ||
    value === "other"
    ? value
    : "supporting";
}
