import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
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

  return {};
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["默认表情", "控制台"] }, error);

export default function AdminEmojiPage() {
  return (
    <main>
      <PageHeader compact title="默认表情" />
      <EmojiAdminPanel />
    </main>
  );
}
