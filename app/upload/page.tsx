import { getCurrentUser } from "@/app/.server/auth/current-user";
import { redirectPage } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { loadUploadSuggestions } from "@/app/.server/upload-suggestions";
import { buttonVariants } from "@/app/components/ui/button";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { UploadClient } from "@/app/upload/upload-client";
import { canPublishWork } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const currentUser = await getCurrentUser(runtime);

  if (!currentUser) {
    redirectPage("/login?next=/upload");
  }

  const suggestions = canPublishWork(currentUser)
    ? await loadUploadSuggestions(runtime)
    : null;

  return {
    currentUser: pickPageFields(currentUser, [
      "id",
      "displayName",
      "permissionKeys",
    ]),
    suggestions,
  };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "上传游戏" }, error);

export default function UploadPage() {
  const { currentUser, suggestions } = useLoaderData<typeof loader>();
  if (!suggestions) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader compact title="需要上传者权限" />

        <Pane>
          <p>上传需要上传者权限，可在「我的账户」申请。</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link className={buttonVariants()} to="/me#upload-access">
              前往我的账户
            </Link>
          </div>
        </Pane>
      </PageContainer>
    );
  }
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
