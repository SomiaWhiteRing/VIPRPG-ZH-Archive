import { requireAccountUser } from "@/app/.server/auth/account-user";
import { runtimeContext } from "@/app/.server/router-context";
import { EmojiLibrary } from "@/app/components/emojis/library";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  await requireAccountUser(args.context.get(runtimeContext), "/me/emojis");
  return null;
}
export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["表情库", "个人中心"] }, error);
export default function EmojiLibraryPage() {
  return (
    <>
      <AccountPageHeader title="表情库" />
      <EmojiLibrary />
    </>
  );
}
