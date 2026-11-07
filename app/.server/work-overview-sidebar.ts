import { searchCatalogsForOwner, sampleCatalogsContainingWork } from "@/app/.server/db/catalogs";
import { isWorkUploader } from "@/app/.server/db/game-library";
import { getMaintainerApplication } from '@/app/.server/db/work-maintainers';
import { getWorkRelationEditorCapabilities } from "@/app/.server/db/relations";
import { getWorkCommunitySummary } from "@/app/.server/db/work-community";
import { pickPageFields } from "@/app/.server/page-data";
import type { AppRuntime } from "@/app/.server/runtime";
import { hasPermission } from "@/lib/authz/permissions";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { WorkOverviewSidebarData } from "@/lib/dto/db/work-community";

export async function getWorkEditInfoHref(
  runtime: AppRuntime,
  workId: number,
  user: ArchiveUser | null,
  deleted = false,
): Promise<string | null> {
  if (!deleted && user && hasPermission(user, "work.update_own") && await isWorkUploader(runtime, workId, user.id))
    return `/me/uploads/${workId}?from=game`;
  if ((!deleted || hasPermission(user, "work.status.update_any"))
    && (hasPermission(user, "work.metadata.update_any") || hasPermission(user, "work.distribution.update_any")))
    return `/admin/works/${workId}`;
  return null;
}

export async function loadWorkOverviewSidebar(
  runtime: AppRuntime,
  workId: number,
  currentUser: ArchiveUser | null,
  publicWork: boolean,
): Promise<WorkOverviewSidebarData> {
  const [community, userCatalogs, containingCatalogs, capabilities, editInfoHref] = await Promise.all([
    getWorkCommunitySummary(runtime, workId, currentUser?.id ?? null),
    currentUser ? searchCatalogsForOwner(runtime, { userId: currentUser.id }) : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
    sampleCatalogsContainingWork(runtime, workId),
    getWorkRelationEditorCapabilities(runtime, workId, currentUser),
    getWorkEditInfoHref(runtime, workId, currentUser),
  ]);
  const maintainerApplication = publicWork && currentUser && !editInfoHref && hasPermission(currentUser, 'work.update_own')
    ? await getMaintainerApplication(runtime, workId, currentUser) : null;
  return {
    currentUser: pickPageFields(currentUser, ["id"]),
    community,
    userCatalogs,
    containingCatalogs,
    showRelationEditor: capabilities.canCreateRelation || capabilities.canCreateTranslation ||
      capabilities.canUpdate || capabilities.canDeleteRelation || capabilities.canDeleteTranslation,
    editInfoHref,
    maintainerApplication,
  };
}
