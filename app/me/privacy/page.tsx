import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/core";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useState } from "react";

import { requireAccountUser } from "@/app/.server/auth/account-user";
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
      label: "work.intro",
      checked: user.profileVisibility.bio,
    },
    {
      name: "showShowcase",
      label: "account.nav.showcase",
      checked: user.profileVisibility.showcase,
    },
    {
      name: "showFriends",
      label: "account.privacy.friends",
      checked: user.profileVisibility.friends,
    },
    {
      name: "showFavorites",
      label: "favorite.label",
      checked: user.profileVisibility.favorites,
    },
    {
      name: "showHistory",
      label: "account.nav.history",
      checked: user.profileVisibility.history,
    },
    {
      name: "showCatalogs",
      label: "core.nav.catalogs",
      checked: user.profileVisibility.catalogs,
    },
    {
      name: "showComments",
      label: "work.stats.commentsShort",
      checked: user.profileVisibility.comments,
    },
    {
      name: "showDiscussions",
      label: "account.privacy.discussion",
      checked: user.profileVisibility.discussions,
    },
  ] as const;

  return { locale: runtime.uiLocale, params, profileSettings, preferences: user.preferences };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "account.nav.privacy"), translate(locale, "header.me")] }, error, locale);
};

export default function PrivacyPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { profileSettings, preferences } = useLoaderData<typeof loader>();
  const [notificationPreferences, setNotificationPreferences] = useState(preferences);
  return (
    <div>
      <AccountPageHeader title={t("account.nav.privacy")} />
      <RedirectFeedback success={{ settingsUpdated: t("account.privacy.savedAll"), privacyUpdated: t("account.privacy.saved"), preferencesUpdated: t("account.preferences.saved") }} />

      <RedirectForm action={`/api/account/privacy?${UI_LOCALE_PARAM}=${locale}`} method="post">
        <input name="section" type="hidden" value="all" />
        <h2 className="mb-3 text-lg font-semibold">{t("account.privacy.title")}</h2>
        <input name="showFriends" type="hidden" value="0" />
        <input name="notifyFriendAdditions" type="hidden" value="0" />
        <input name="receivePrivateMessages" type="hidden" value="0" />
        <div className="divide-y divide-border border-b border-border">
          <div className="py-2">
            <Label className="flex min-h-10 cursor-pointer items-center gap-2">
              <Checkbox name="receivePrivateMessages" value="1" checked={notificationPreferences.receivePrivateMessages}
                onCheckedChange={checked => setNotificationPreferences(current => ({ ...current, receivePrivateMessages: checked === true }))} />
              {t("account.privacy.messages")}
            </Label>
          </div>
          <div className="py-2">
            <Label className="flex min-h-10 cursor-pointer items-center gap-2">
              <Checkbox name="notifyFriendAdditions" value="1" checked={notificationPreferences.notifyFriendAdditions}
                onCheckedChange={checked => setNotificationPreferences(current => ({ ...current, notifyFriendAdditions: checked === true }))} />
              {t("account.privacy.friendAlerts")}
            </Label>
          </div>
          <fieldset className="py-4">
            <legend className="sr-only">{t("account.privacy.profileItems")}</legend>
            <div aria-hidden="true" className="mb-3 text-sm font-semibold">{t("account.privacy.profileItems")}</div>
            <div className="flex flex-wrap gap-2">
              {profileSettings.map((setting) => (
                <Label key={setting.name} htmlFor={`profile-${setting.name}`} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/10">
                  <Checkbox defaultChecked={setting.checked} id={`profile-${setting.name}`} name={setting.name} value="1" />
                  {t(setting.label)}
                </Label>
              ))}
            </div>
          </fieldset>
        </div>
        <AccountPreferencesFields preferences={notificationPreferences}
          onNotifyUploadedWorkCommentsChange={checked => setNotificationPreferences(current => ({ ...current, notifyUploadedWorkComments: checked }))} />
        <div className="mt-5"><Rm2kButton type="submit">{t("account.preferences.save")}</Rm2kButton></div>
      </RedirectForm>
    </div>
  );
}
