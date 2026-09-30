import { getCurrentUser } from "@/app/.server/auth/current-user";
import { pickPageFields } from "@/app/.server/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { PageContainer } from "@/app/components/ui/page-container";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { canAccessOwnWorks } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet, useLoaderData, useMatch } from "react-router";
import { AccountNavigation } from "./account-navigation";
import type { AccountOutletContext } from "./mobile-account-navigation";
export { shouldRevalidatePermissionPanel as shouldRevalidate } from "@/lib/ui/route-revalidation";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const user = await getCurrentUser(runtime);

  return {
    user: pickPageFields(user, [
      "avatarBlobSha256",
      "displayName",
      "id",
      "status",
      "permissionKeys",
    ]),
  };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "个人中心" }, error);

export default function AccountLayout() {
  const { user } = useLoaderData<typeof loader>();
  const fullWidth = Boolean(useMatch("/me/uploads/:workId"));
  const canUpload = Boolean(user && canAccessOwnWorks(user));
  const children = <Outlet context={{ canUpload } satisfies AccountOutletContext} />;
  return (
    <PageContainer>
      {/* Let content expand even when the sidebar is hidden by external styles. */}
      <div className={fullWidth ? "block" : "md:flex md:gap-8"}>
        {!fullWidth ? (
          <>
            <div className="sticky top-20 hidden w-[232px] shrink-0 self-start md:block">
              {user ? (
                <div className="mb-3 flex min-w-0 items-center gap-3 px-2">
                  <UserAvatar
                    avatarBlobSha256={user.avatarBlobSha256}
                    displayName={user.displayName}
                    size={36}
                  />
                  <strong className="min-w-0 truncate text-sm font-medium">{user.displayName}</strong>
                </div>
              ) : null}
              <AccountNavigation
                canUpload={canUpload}
              />
            </div>
          </>
        ) : null}
        <div className={fullWidth ? "min-w-0 flex-1 pt-5 md:pt-0" : "min-w-0 flex-1"}>{children}</div>
      </div>
    </PageContainer>
  );
}
