import { PageHeader } from "@/app/components/ui/page-header";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { EmojiAdminPanel } from "./panel";

export const dynamic = "force-dynamic";

export default async function AdminEmojiPage() {
  await requirePagePermission("/admin/emojis", "custom_emoji.manage");
  return (
    <main>
      <PageHeader title="站点表情" />
      <EmojiAdminPanel />
    </main>
  );
}
