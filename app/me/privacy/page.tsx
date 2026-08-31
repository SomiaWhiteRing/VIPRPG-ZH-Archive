import { CheckboxField } from "@/app/components/ui/checkbox-field";
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { requireAccountUser } from "@/lib/server/auth/account-user";

export const dynamic = "force-dynamic";

type Params = {
  privacyUpdated?: string;
  error?: string;
};

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireAccountUser("/me/privacy");
  const params = await searchParams;
  const settings = [
    { name: "showBio", label: "在个人主页展示简介", checked: user.profileVisibility.bio },
    { name: "showFavorites", label: "在个人主页展示收藏", checked: user.profileVisibility.favorites },
    { name: "showHistory", label: "在个人主页展示游玩历史", checked: user.profileVisibility.history },
    { name: "showCatalogs", label: "在个人主页展示目录", checked: user.profileVisibility.catalogs },
    { name: "showComments", label: "在个人主页展示评论", checked: user.profileVisibility.comments },
  ];

  return (
    <div>
      <PageHeader title="隐私" subtitle="选择哪些内容显示在你的个人主页。" />
      {params.privacyUpdated ? <p className="mb-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">隐私设置已更新。</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">{params.error}</p> : null}
      <form action="/api/account/privacy" method="post">
        <div className="divide-y divide-border border-y border-border">
          {settings.map((setting) => (
            <div className="py-2" key={setting.name}>
              <CheckboxField defaultChecked={setting.checked} label={setting.label} name={setting.name} />
            </div>
          ))}
        </div>
        <p className="mb-0 mt-3 text-xs text-muted">这些设置只控制个人主页。已发布的目录仍可被浏览，已发布的评论仍会显示在作品页。</p>
        <div className="mt-5"><Rm2kButton type="submit">保存隐私设置</Rm2kButton></div>
      </form>
    </div>
  );
}
