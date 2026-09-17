import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";
export function loader() {
  throw new Response(null, { status: 404 });
}
export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "页面不存在" }, error);

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1>页面不存在</h1>
      <Link to="/">返回首页</Link>
    </main>
  );
}
