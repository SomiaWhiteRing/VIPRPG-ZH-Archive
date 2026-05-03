import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { getCreatorForAdminEdit } from "@/lib/server/db/creator-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

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
          <p className="subtitle">
            Creator slug 暂不在这里修改，避免破坏公开 URL 和导入识别。
          </p>
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
              <span className="muted-line">
                简介写入 creators.extra_json.bio，不新增迁移；后续需要索引时再提升为独立字段。
              </span>
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
                    {creatorRoleLabel(credit.roleKey)} / {statusLabel(credit.status)}
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
          <h2>Release 职务</h2>
          {creator.adminReleaseCredits.length > 0 ? (
            <ul className="plain-list">
              {creator.adminReleaseCredits.map((credit) => (
                <li key={`${credit.releaseId}-${credit.roleKey}`}>
                  <Link href={`/admin/releases/${credit.releaseId}`}>
                    {credit.workTitle} / {credit.releaseLabel}
                  </Link>
                  <span className="muted-line">
                    {creatorRoleLabel(credit.roleKey)} / {statusLabel(credit.status)}
                    {credit.notes ? ` / ${credit.notes}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-line">暂无 Release 职务。</p>
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

function creatorRoleLabel(value: string): string {
  const labels: Record<string, string> = {
    author: "作者",
    scenario: "剧本",
    graphics: "图像",
    music: "音乐",
    translator: "翻译",
    proofreader: "校对",
    image_editor: "修图",
    publisher: "发布",
    repacker: "整理",
    editor: "编辑",
  };

  return labels[value] ?? value;
}

function statusLabel(value: string): string {
  switch (value) {
    case "published":
      return "已发布";
    case "hidden":
      return "隐藏";
    case "draft":
      return "草稿";
    case "deleted":
      return "已删除";
    default:
      return value;
  }
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
