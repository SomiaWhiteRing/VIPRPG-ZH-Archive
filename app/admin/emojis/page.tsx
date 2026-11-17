import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { runtimeContext } from "@/app/.server/router-context";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { EmojiAdminPanel } from "./panel";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  await requirePagePermission(
    runtime,
    "/admin/emojis",
    "emoji.defaults.manage",
  );

  return { locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "emoji.library.defaultTitle"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};
export default function AdminEmojiPage() {
  const t = useMessages();
  return (
    <main>
      <PageHeader compact title={t("emoji.library.defaultTitle")} />
      <EmojiAdminPanel />
    </main>
  );
}
