import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { runtimeContext } from "@/app/.server/router-context";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { EmojiAdminPanel } from "./panel";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  await requirePagePermission(runtime, "/admin/emojis", "custom_emoji.manage");

  return {};
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["站点表情", "控制台"] }, error);

export default function AdminEmojiPage() {
  return (
    <main>
      <PageHeader
        compact
        title="站点表情"
        subtitle="上传表情并管理其公开状态。"
      />
      <EmojiAdminPanel />
    </main>
  );
}
