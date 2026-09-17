import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { requirePublicUser } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { PublicProfileNavigation } from "./public-profile-navigation";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const user = await requirePublicUser(runtime, (await params).userId);

  return { user };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: [loaderData?.user.displayName || "用户", "个人主页"] }, error);

export default function PublicUserLayout() {
  const { user } = useLoaderData<typeof loader>();
  const children = <Outlet />;
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-7 sm:px-6">
      <header className="flex items-start gap-4">
        <UserAvatar
          avatarBlobSha256={user.avatarBlobSha256}
          className="size-20"
          displayName={user.displayName}
          size={80}
        />
        <div className="min-w-0">
          <h1 className="m-0 truncate text-2xl font-extrabold">
            {user.displayName}
          </h1>
          {user.profileVisibility.bio ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
              {user.bio || "这位用户还没有填写简介。"}
            </p>
          ) : null}
        </div>
      </header>
      <PublicProfileNavigation
        userId={user.id}
        visibility={user.profileVisibility}
      />
      <div className="min-w-0">{children}</div>
    </main>
  );
}
