import { useMessages } from "@/lib/i18n/react";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
export default function DiscussionNotFound() {
  const t = useMessages();
  return (
    <PageContainer>
      <PageHeader compact title={t("forum.unavailable")} />
      <Link
        prefetch="none"
        className="my-4 inline-block text-primary"
        to="/discussions"
      >
        {t("forum.back")}
      </Link>
    </PageContainer>
  );
}
