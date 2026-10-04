import { Link, isRouteErrorResponse, useLocation, useRevalidator, useRouteError } from "react-router";
import { Button } from "@/app/components/ui/button";

export function TimelineError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const location = useLocation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <section className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-6" aria-label="时间线加载结果">
    <h2 className="m-0 text-xl font-semibold">{missing ? "页面不存在" : "暂时无法打开时间线"}</h2>
    <p className="m-0 text-sm text-muted" role="alert">{missing ? "这位用户或这条内容已不可访问。" : "请重试，或返回最新动态重新查看。"}</p>
    <div className="flex flex-wrap gap-3">
      {!missing && <Button type="button" disabled={revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()}>{revalidator.state !== "idle" ? "正在重试…" : "重试"}</Button>}
      <Button asChild variant="outline"><Link to={missing ? "/timeline" : location.pathname}>返回{location.pathname === "/me/timeline" ? "设置" : "最新动态"}</Link></Button>
    </div>
  </section>;
}
