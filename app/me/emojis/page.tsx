import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { runtimeContext } from "@/app/.server/router-context";
import { EmojiLibrary } from "@/app/components/emojis/library";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  await requireAccountUser(runtime, "/me/emojis");
  return { locale: runtime.uiLocale };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "account.nav.emojis"), translate(locale, "header.me")] }, error, locale);
};
export default function EmojiLibraryPage() {
  const t = useMessages();
  return (
    <>
      <AccountPageHeader title={t("account.nav.emojis")} />
      <EmojiLibrary />
    </>
  );
}
