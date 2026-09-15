import { PageContainer } from "@/app/components/ui/page-container";
import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canPublishWork } from "@/lib/authz/permissions";
import { UploadClient } from "@/app/upload/upload-client";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { loadUploadSuggestions } from "@/app/upload/upload-suggestions";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect("/login?next=/upload");
  }

  if (!canPublishWork(currentUser)) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader compact title="需要上传者权限" />

        <Pane>
          <p>上传需要上传者权限，可在「我的账户」申请。</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link className={buttonVariants()} href="/me#upload-access">
              前往我的账户
            </Link>
          </div>
        </Pane>
      </PageContainer>
    );
  }

  const suggestions = await loadUploadSuggestions();

  return (
    <PageContainer className="space-y-5">
      <PageHeader compact title="上传游戏" />
      <UploadClient
        currentUser={{
          id: currentUser.id,
          displayName: currentUser.displayName,
          permissionKeys: currentUser.permissionKeys,
        }}
        suggestions={suggestions}
      />
    </PageContainer>
  );
}
