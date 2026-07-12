import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getCharacterForAdminEdit } from "@/lib/server/db/taxonomy-library";
import { formatUnreadCount } from "@/lib/format";

export const dynamic = "force-dynamic";

type AdminCharacterEditPageProps = {
  params: Promise<{
    characterId: string;
  }>;
};

export default async function AdminCharacterEditPage({
  params,
}: AdminCharacterEditPageProps) {
  const { characterId: rawCharacterId } = await params;
  const characterId = parseId(rawCharacterId);
  const adminUser = await requireAdminPageUser(`/admin/characters/${characterId}`);
  const [character, unreadInboxCount] = await Promise.all([
    getCharacterForAdminEdit(characterId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!character) {
    notFound();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Edit Character</p>
          <h1>{character.primaryName}</h1>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin/characters">
            返回角色维护
          </Link>
          {character.workCount > 0 ? (
            <Link className="button" href={`/characters/${character.slug}`}>
              公开页
            </Link>
          ) : null}
          <Link className="button" href="/inbox">
            站内信
            {unreadInboxCount > 0 ? (
              <span className="notification-badge">
                {formatUnreadCount(unreadInboxCount)}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <form
        action={`/api/admin/characters/${character.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="character_id" type="hidden" value={character.id} />
        <section className="form-section">
          <h2>角色资料</h2>
          <div className="upload-form-grid">
            <label className="field">
              Slug
              <input readOnly value={character.slug} />
              <span className="muted-line">不可修改</span>
            </label>
            <label className="field">
              名称
              <input defaultValue={character.primaryName} name="primary_name" required />
            </label>
            <label className="field">
              原名
              <input defaultValue={character.originalName ?? ""} name="original_name" />
            </label>
            <label className="field wide-field">
              简介
              <textarea defaultValue={character.description ?? ""} name="description" rows={6} />
            </label>
          </div>
        </section>

        <section className="form-section">
          <h2>合并重复角色</h2>
          <label className="field">
            目标角色 slug
            <input name="merge_target_slug" placeholder="留空则不合并" />
            <span className="muted-line">
              提交后，登场关系会移至目标角色，当前角色会被删除。
            </span>
          </label>
        </section>

        <div className="actions">
          <button className="button primary" type="submit">
            保存角色资料
          </button>
        </div>
      </form>
    </main>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    notFound();
  }

  return id;
}
