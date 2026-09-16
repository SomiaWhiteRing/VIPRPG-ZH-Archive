import { getCurrentUser } from "@/app/.server/auth/current-user";
import { pickPageFields } from "@/app/.server/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { PageContainer } from "@/app/components/ui/page-container";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { canAccessOwnWorks } from "@/lib/authz/permissions";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { AccountNavigation } from "./account-navigation";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const user = await getCurrentUser(runtime);

  return {
    user: pickPageFields(user, [
      "avatarBlobSha256",
      "displayName",
      "email",
      "id",
      "status",
      "permissionKeys",
    ]),
  };
}

export default function AccountLayout() {
  const { user } = useLoaderData<typeof loader>();
  const children = <Outlet />;
  return (
    <PageContainer>
      <div className="account-layout md:grid md:grid-cols-[232px_minmax(0,1fr)] md:gap-8">
        <div className="account-navigation-slot sticky top-20 hidden self-start md:block">
          {user ? (
            <div className="mb-5 flex min-w-0 items-center gap-3 px-2">
              <UserAvatar
                avatarBlobSha256={user.avatarBlobSha256}
                displayName={user.displayName}
              />
              <div className="min-w-0">
                <strong className="block truncate">{user.displayName}</strong>
                <span className="block truncate text-xs text-muted">
                  {user.email}
                </span>
              </div>
            </div>
          ) : null}
          <AccountNavigation
            canUpload={Boolean(user && canAccessOwnWorks(user))}
          />
        </div>
        <div className="account-navigation-slot md:hidden">
          <AccountNavigation
            canUpload={Boolean(user && canAccessOwnWorks(user))}
          />
        </div>
        <div className="min-w-0 pt-5 md:pt-0">{children}</div>
      </div>
    </PageContainer>
  );
}
