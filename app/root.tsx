import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
} from "react-router";
import { getCurrentUser } from "./.server/auth/current-user";
import { countUnreadInboxItemsForUser } from "./.server/db/inbox";
import { runtimeContext } from "./.server/router-context";
import { SiteFooter } from "./components/site-footer";
import { SiteHeaderNav } from "./components/site-header-nav";
import { DiscussionVisitBoundary } from "./discussions/visit";
import "./globals.css";

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors(undefined, error);

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const user = await getCurrentUser(runtime);
  const unread = user ? await countUnreadInboxItemsForUser(runtime, user) : 0;
  return {
    session: user
      ? {
          id: user.id,
          displayName: user.displayName,
          avatarBlobSha256: user.avatarBlobSha256,
          unread,
          permissionKeys: user.permissionKeys,
          isBootstrapAdmin: user.isBootstrapAdmin,
        }
      : null,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  // Immersive Translate and other extensions can add document-root attributes
  // before hydration. Tolerate those attributes without suppressing diagnostics
  // inside the application tree.
  return (
    <html
      lang="zh-Hans"
      className="scroll-smooth motion-reduce:scroll-auto"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <link rel="icon" href="/icon/windI.png" />
      </head>
      <body
        className="min-h-screen bg-background font-sans text-foreground antialiased"
        suppressHydrationWarning
      >
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { session } = useLoaderData<typeof loader>();
  return (
    <>
      <DiscussionVisitBoundary />
      <SiteHeaderNav
        session={session}
        loginLink={
          !session ? (
            <Link
              className="inline-flex min-h-8 items-center justify-center rounded-md border-2 border-white bg-linear-to-b from-rm2k-green-1 via-[#3f6c4e] to-rm2k-green-2 px-3 py-1.5 text-xs font-semibold text-white shadow-[3px_3px_0_rgb(23_33_43/30%),inset_0_0_0_2px_rgb(0_0_0/20%)] hover:brightness-110"
              to="/login"
            >
              登录
            </Link>
          ) : null
        }
      />
      <Outlet />
      <SiteFooter />
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-bold">
        {missing ? "页面不存在" : "暂时无法打开页面"}
      </h1>
      <p className="my-4">
        {missing ? "内容可能已被移除，或链接有误。" : "请刷新后重试。"}
      </p>
      <Link to="/">返回首页</Link>
    </main>
  );
}
