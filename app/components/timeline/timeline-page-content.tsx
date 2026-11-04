import { Link } from "react-router";
import type { TimelinePageData } from "@/app/.server/timeline/page-data";
import { TimelineWorkspace } from "@/app/components/timeline/timeline-workspace";
import { AccountSection } from "@/app/components/profile/account-content";
import { HomeCommunity } from "@/app/components/home/home-community";
import { HomePageLayout } from "@/app/components/home/home-page-layout";
import { PageContainer } from "@/app/components/ui/page-container";
import { UserAvatar } from "@/app/components/ui/user-avatar";

export function TimelinePageContent({ values, basePath }: { values: TimelinePageData; basePath: string }) {
  const { viewer, topics, ...workspace } = values;
  return <PageContainer>
    {workspace.focused && <Link to="/timeline" className="mb-3 inline-block text-sm text-primary hover:underline">返回时间线</Link>}
    <HomePageLayout hideSidebarOnMobile
      main={<TimelineWorkspace {...workspace} basePath={basePath} canCompose={!!workspace.viewerId && !workspace.focused} />}
      sidebar={<aside aria-label="个人入口与讨论区" className="grid min-w-0 gap-6">
        {viewer ? <AccountSection title="我的主页" href={`/users/${viewer.id}`} divided={false} linkText="进入 →">
          <Link to={`/users/${viewer.id}`} className="flex min-w-0 items-center gap-3 hover:text-primary">
            <UserAvatar avatarBlobSha256={viewer.avatarBlobSha256} displayName={viewer.displayName} size={48} className="size-12 shrink-0" />
            <span className="min-w-0 wrap-anywhere text-sm font-semibold">{viewer.displayName}</span>
          </Link>
        </AccountSection> : null}
        <HomeCommunity topics={topics} className="min-[981px]:border-l-0 min-[981px]:pl-0 min-[1101px]:pl-0" />
      </aside>}
    />
  </PageContainer>;
}
