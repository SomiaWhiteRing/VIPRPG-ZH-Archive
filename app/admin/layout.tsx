import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "控制台" }, error);

export default function AdminLayout() {
  const children = <Outlet />;
  return (
    <div className="mx-auto w-[min(1280px,calc(100vw-2rem))] py-5 sm:py-7 [&_main]:grid [&_main]:gap-5">
      {children}
    </div>
  );
}
