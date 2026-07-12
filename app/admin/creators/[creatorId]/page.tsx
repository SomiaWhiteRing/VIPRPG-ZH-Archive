import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { getCreatorForAdminEdit } from "@/lib/server/db/creator-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatUnreadCount } from "@/lib/format";
import {
  creatorRoleLabel,
  workStatusLabel,
} from "@/lib/labels";

export const dynamic = "force-dynamic";

type AdminCreatorEditPageProps = {
  params: Promise<{
    creatorId: string;
  }>;
};

export default async function AdminCreatorEditPage({
  params,
}: AdminCreatorEditPageProps) {
  const { creatorId: rawCreatorId } = await params;
  const creatorId = parseCreatorId(rawCreatorId);
  const adminUser = await requireAdminPageUser(`/admin/creators/${creatorId}`);
  const [creator, unreadInboxCount] = await Promise.all([
    getCreatorForAdminEdit(creatorId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!creator) {
    notFound();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Edit Creator</p>
          <h1>{creator.name}</h1>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin/creators">
            返回作者维护
          </Link>
          <Link className="button" href={`/creators/${creator.slug}`}>
            查看公开页
          </Link>
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
        action={`/api/admin/creators/${creator.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="creator_id" type="hidden" value={creator.id} />

        <section className="form-section">
          <h2>作者资料</h2>
          <div className="upload-form-grid">
            <label className="field">
              Slug
              <input readOnly value={creator.slug} />
              <span className="muted-line">不可修改</span>
            </label>
            <label className="field">
              名称
              <input defaultValue={creator.name} name="name" required type="text" />
            </label>
            <label className="field">
              原名
              <input
                defaultValue={creator.originalName ?? ""}
                name="original_name"
                type="text"
              />
            </label>
            <label className="field">
              个人链接
              <input
                defaultValue={creator.websiteUrl ?? ""}
                name="website_url"
                type="url"
              />
            </label>
            <label className="field wide-field">
              简介
              <textarea defaultValue={creator.bio ?? ""} name="bio" rows={6} />
            </label>
          </div>
        </section>

        <div className="actions">
          <button className="button primary" type="submit">
            保存作者资料
          </button>
        </div>
      </form>

      <section className="section-grid admin-creator-credit-grid" aria-label="作者关联">
        <section className="card">
          <h2>作品层职务</h2>
          {creator.adminWorkCredits.length > 0 ? (
            <ul className="plain-list">
              {creator.adminWorkCredits.map((credit) => (
                <li key={`${credit.workId}-${credit.roleKey}`}>
                  <Link href={`/admin/works/${credit.workId}`}>{credit.workTitle}</Link>
                  <span className="muted-line">
                    {creatorRoleLabel(credit.roleKey)} / {workStatusLabel(credit.status)}
                    {credit.notes ? ` / ${credit.notes}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-line">暂无作品层职务。</p>
          )}
        </section>

        <section className="card">
          <h2>发布版本职务</h2>
          {creator.adminReleaseCredits.length > 0 ? (
            <ul className="plain-list">
              {creator.adminReleaseCredits.map((credit) => (
                <li key={`${credit.releaseId}-${credit.roleKey}`}>
                  <Link href={`/admin/releases/${credit.releaseId}`}>
                    {credit.workTitle} / {credit.releaseLabel}
                  </Link>
                  <span className="muted-line">
                    {creatorRoleLabel(credit.roleKey)} / {workStatusLabel(credit.status)}
                    {credit.notes ? ` / ${credit.notes}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-line">暂无发布版本职务。</p>
          )}
        </section>
      </section>
    </main>
  );
}

function parseCreatorId(value: string): number {
  const creatorId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(creatorId) || creatorId <= 0) {
    notFound();
  }

  return creatorId;
}
