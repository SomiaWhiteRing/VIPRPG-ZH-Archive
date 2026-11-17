import { translate } from "@/lib/i18n/core";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import "./admin.css";

export const meta: MetaFunction = ({ error, location, matches }) => {
  const locale = pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "admin.characterIndex.console") }, error, locale);
};

export default function AdminLayout() {
  const children = <Outlet />;
  return (
    <div className="admin-console mx-auto min-w-0 w-[min(1280px,calc(100vw-2rem))] wrap-anywhere py-5 sm:py-7 [&_main]:grid [&_main]:grid-cols-1 [&_main]:min-w-0 [&_main]:gap-5">
      {children}
    </div>
  );
}
