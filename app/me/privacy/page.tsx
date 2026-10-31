import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { requireAccountUser } from "@/app/.server/auth/account-user";
import { CheckboxField } from "@/app/components/ui/checkbox-field";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { AccountPreferencesFields } from "./account-preferences-fields";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const user = await requireAccountUser(runtime, "/me/privacy");
  const params = await searchParams;
  const profileSettings = [
    {
      name: "showBio",
      label: "简介",
      checked: user.profileVisibility.bio,
    },
    {
      name: "showShowcase",
      label: "喜爱展柜",
      checked: user.profileVisibility.showcase,
    },
    {
      name: "showFriends",
      label: "好友",
      checked: user.profileVisibility.friends,
    },
    {
      name: "showFavorites",
      label: "收藏",
      checked: user.profileVisibility.favorites,
    },
    {
      name: "showHistory",
      label: "游玩历史",
      checked: user.profileVisibility.history,
    },
    {
      name: "showCatalogs",
      label: "目录",
      checked: user.profileVisibility.catalogs,
    },
    {
      name: "showComments",
      label: "评论",
      checked: user.profileVisibility.comments,
    },
    {
      name: "showDiscussions",
      label: "讨论",
      checked: user.profileVisibility.discussions,
    },
  ];

  return { params, profileSettings, preferences: user.preferences };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["隐私与偏好", "个人中心"] }, error);

export default function PrivacyPage() {
  const { profileSettings, preferences } = useLoaderData<typeof loader>();
  return (
    <div>
      <AccountPageHeader title="隐私与偏好" />
      <RedirectFeedback success={{ settingsUpdated: "隐私与偏好已更新。", privacyUpdated: "隐私设置已更新。", preferencesUpdated: "偏好设置已更新。" }} />

      <RedirectForm action="/api/account/privacy" method="post">
        <input name="section" type="hidden" value="all" />
        <h2 className="mb-3 text-lg font-semibold">隐私</h2>
        <input name="showFriends" type="hidden" value="0" />
        <input name="notifyFriendAdditions" type="hidden" value="0" />
        <input name="receivePrivateMessages" type="hidden" value="0" />
        <div className="divide-y divide-border border-b border-border">
          <div className="py-2">
            <CheckboxField name="receivePrivateMessages" label="接收私信" defaultChecked={preferences.receivePrivateMessages} />
          </div>
          <div className="py-2">
            <CheckboxField name="notifyFriendAdditions" label="接收他人的好友提醒" defaultChecked={preferences.notifyFriendAdditions} />
          </div>
          <fieldset className="py-4">
            <legend className="sr-only">在个人主页展示</legend>
            <div aria-hidden="true" className="mb-3 text-sm font-semibold">在个人主页展示</div>
            <div className="flex flex-wrap gap-2">
              {profileSettings.map((setting) => (
                <Label key={setting.name} htmlFor={`profile-${setting.name}`} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/10">
                  <Checkbox defaultChecked={setting.checked} id={`profile-${setting.name}`} name={setting.name} value="1" />
                  {setting.label}
                </Label>
              ))}
            </div>
          </fieldset>
        </div>
        <AccountPreferencesFields preferences={preferences} />
        <div className="mt-5"><Rm2kButton type="submit">保存设置</Rm2kButton></div>
      </RedirectForm>
    </div>
  );
}
