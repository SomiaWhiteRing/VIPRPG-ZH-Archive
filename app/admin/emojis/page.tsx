import { PageHeader } from "@/app/components/ui/page-header";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { EmojiAdminPanel } from "./panel";

export const dynamic = "force-dynamic";

export default async function AdminEmojiPage() {
  await requirePagePermission("/admin/emojis", "custom_emoji.manage");
  return (
    <main>
      <PageHeader compact title="站点表情" subtitle="上传表情并管理其公开状态。" />
      <EmojiAdminPanel />
    </main>
  );
}
