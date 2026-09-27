import { searchCatalogsForOwner, sampleCatalogsContainingWork } from "@/app/.server/db/catalogs";
import { isWorkUploader } from "@/app/.server/db/game-library";
import { getWorkRelationEditorCapabilities } from "@/app/.server/db/relations";
import { getWorkCommunitySummary } from "@/app/.server/db/work-community";
import { pickPageFields } from "@/app/.server/page-data";
import type { AppRuntime } from "@/app/.server/runtime";
import { hasPermission } from "@/lib/authz/permissions";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { WorkOverviewSidebarData } from "@/lib/dto/db/work-community";

export async function loadWorkOverviewSidebar(
  runtime: AppRuntime,
  workId: number,
  currentUser: ArchiveUser | null,
): Promise<WorkOverviewSidebarData> {
  const [community, userCatalogs, containingCatalogs, capabilities, canEditOwnWork] = await Promise.all([
    getWorkCommunitySummary(runtime, workId, currentUser?.id ?? null),
    currentUser ? searchCatalogsForOwner(runtime, { userId: currentUser.id }) : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
    sampleCatalogsContainingWork(runtime, workId),
    getWorkRelationEditorCapabilities(runtime, workId, currentUser),
    currentUser && hasPermission(currentUser, "work.update_own") ? isWorkUploader(runtime, workId, currentUser.id) : false,
  ]);
  return {
    currentUser: pickPageFields(currentUser, ["id"]),
    community,
    userCatalogs,
    containingCatalogs,
    showRelationEditor: capabilities.canCreateRelation || capabilities.canCreateTranslation ||
      capabilities.canUpdate || capabilities.canDeleteRelation || capabilities.canDeleteTranslation,
    editInfoHref: canEditOwnWork ? `/me/uploads/${workId}?from=game`
      : hasPermission(currentUser, "work.metadata.update_any") ? `/admin/works/${workId}` : null,
  };
}
