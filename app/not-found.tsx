import { Link } from "react-router";
export function loader() {
  throw new Response(null, { status: 404 });
}
export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1>页面不存在</h1>
      <Link to="/">返回首页</Link>
    </main>
  );
}
