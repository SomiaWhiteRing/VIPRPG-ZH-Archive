import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";

export const dynamic = "force-static";

export const meta: MetaFunction = ({ error, location, matches }) => {
  const locale = pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "about.title") }, error, locale);
};

export default function AboutPage() {
  const t = useMessages();
  return (
    <PageContainer className="space-y-5">
      <PageHeader compact title={t("about.title")} />

      <Pane heading={t("about.intro")}>
        <p>
          {t("about.intro.archive")}<br/>
          {t("about.intro.networkBefore")}<span className="line-through">{t("about.intro.networkAside")}</span>{t("about.intro.networkAfter")}<br/>
          {t("about.intro.access")}
        </p>
      </Pane>

      <Pane heading={t("about.features")}>
        <p>
          {t("about.features.download")}<br/>
          {t("about.features.welcome")}
        </p>
        <p>
          {t("about.features.moreBefore")}<span className="line-through">{t("about.features.moreAside")}</span>{t("about.features.moreAfter")}<br/>
          {t("about.features.organize")}<br/>
          {t("about.features.play")}<br/>
          {t("about.features.directory")}<br/>
          {t("about.features.explore")}
        </p>
      </Pane>

      <Pane heading={t("about.rules")}>
        <p>
          {t("about.rules.posts")}<br/>
          {t("about.rules.nonVip")}<br/>
          {t("about.rules.watchBefore")}<span className="text-destructive">ヲチスレ</span>{t("about.rules.watchAfter")}<br/>
          {t("about.rules.changes")}<br/>
        </p>
      </Pane>

      <Pane heading={t("about.storage")}>
        <p>
          {t("about.storage.overlap")}<br/>
          {t("about.storage.shared")}<br/>
          {t("about.storage.core")}<br/>
          {t("about.storage.dedup")}<br/>
          {t("about.storage.zip")}<br/>
        </p>
        <p>
          {t("about.storage.savings")}<br/>
          {t("about.storage.limit")}<br/>
          {t("about.storage.external")}<br/>
          {t("about.storage.hostsBefore")}
          <Link to="https://www.lanzou.com/">{t("about.storage.hostsLanzou")}</Link>
          {t("about.storage.hostsSeparator")}
          <Link to="https://mega.nz/">MEGA</Link>
          {t("about.storage.hostsOr")}
          <Link to="https://drive.google.com/">Google Drive</Link>
          {t("about.storage.hostsAfter")}<br/>
        </p>
        <p id="non-viprpg-storage" className="scroll-mt-24">
          {t("about.storage.update")}<br/>
          {t("about.storage.unshared")}<br/>
          {t("about.storage.cleanup")}<br/>
          {t("about.storage.submit")}<br/>
        </p>
      </Pane>

      <Pane heading={t("about.thanks")}>
        <p>
          {t("about.thanks.inspiration")}<br/>
          {t("about.thanks.easyrpg")}<br/>
          {t("about.thanks.community")}
        </p>
      </Pane>
    </PageContainer>
  );
}
