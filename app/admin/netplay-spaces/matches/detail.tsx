import { Link, useLoaderData, useLocation, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAdministratorPage } from "@/app/.server/auth/authorize";
import { getAdminNetplayMatch, getNetplayRecordingSummary } from "@/app/.server/db/admin-netplay-matches";
import { runtimeContext } from "@/app/.server/router-context";
import { buttonVariants } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { formatDuration, formatExactTimestamp } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { MATCHES_PATH, endReasonLabel } from "./labels";

const ROUTES: Readonly<Record<string, string>> = {
  direct: "WebRTC 直连", webrtc: "WebRTC", turn: "UDP TURN", websocket: "WebSocket 转发",
  hong_kong_websocket: "香港 WebSocket 转发", hong_kong_turn_udp: "香港 UDP TURN",
  finish_websocket: "WebSocket 终局补发", finish_webrtc: "WebRTC 终局补发",
};

function routeLabel(path: string) {
  return Object.hasOwn(ROUTES, path) ? ROUTES[path] : path;
}

export async function loader({ context, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const id = params.matchId!;
  await requireAdministratorPage(runtime, `${MATCHES_PATH}/${id}`);
  const match = await getAdminNetplayMatch(runtime, id);
  if (!match) throw new Response(null, { status: 404 });
  const seats = await Promise.all(match.seats.map(async seat => ({
    ...seat, summary: await getNetplayRecordingSummary(runtime, id, seat.seat),
  })));
  return { ...match, seats };
}

export const meta: MetaFunction = ({ error }) => pageMetaDescriptors({ title: ["对局详情", "控制台"] }, error);

export default function AdminNetplayMatchDetail() {
  const match = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const primary = match.room.route;
  const backup = match.room.backup;
  return (
    <main>
      <PageHeader compact title={`房间 #${match.room.roomId} 的对局`} subtitle={match.id} actions={
        <Link className={buttonVariants({ variant: "outline" })} to={MATCHES_PATH + search}>返回对局记录</Link>
      } />
      <Pane>
        <StatList columns={3} items={[
          { label: "开局时间", value: formatExactTimestamp(new Date(match.startedAt).toISOString()) },
          { label: "主线路", value: primary ? routeLabel(primary) : "—" },
          { label: "备用线路", value: backup ? routeLabel(backup) : "—" },
        ]} />
      </Pane>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        {match.seats.map(seat => {
          const { summary } = seat;
          const expected = (seat.last_sequence ?? -1) + 1;
          const upload = !seat.chunks ? "未上传" : !seat.end_reason ? "部分上传" : "已上传";
          const missing = expected - seat.chunks + summary.missingFiles;
          return (
            <Pane key={seat.seat} heading={`席位 ${seat.seat}`} headingAction={seat.chunks ? (
              <a className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/api/admin/netplay-matches/${match.id}/recordings/${seat.seat}`}>
                下载逐帧记录
              </a>
            ) : undefined}>
              <StatList items={[
                { label: "参战账号", value: seat.user_id ? (
                  <Link className="text-primary hover:underline" to={`/admin/users?q=${seat.user_id}`}>
                    {seat.current_name ?? seat.display_name} #{seat.user_id}
                  </Link>
                ) : seat.display_name },
                { label: "归档版本", value: seat.archive_version_id ? `#${seat.archive_version_id}` : "—" },
                { label: "结束原因", value: endReasonLabel(seat.end_reason) },
                { label: "比分", value: seat.score ? `${seat.score[1]} 比 ${seat.score[2]}` : "—" },
                { label: "结算帧", value: seat.score?.[0] ?? "—" },
                { label: "收到输入的线路", value: summary.routes.map(routeLabel).join(" / ") || "—" },
                { label: "等帧", value: summary.waits
                  ? `${summary.waits} 次 · 最长 ${formatDuration(summary.longestWaitMs, { precision: 3 })} · 累计 ${formatDuration(summary.totalWaitMs, { precision: 3 })}`
                  : seat.chunks ? "无等帧记录" : "—" },
                { label: "上传状态", value: `${upload}${expected ? ` · ${seat.chunks}/${expected} 段` : ""}${missing ? ` · 缺少 ${missing} 段` : ""}` },
                { label: "最近上传", value: seat.last_received_at ? formatExactTimestamp(new Date(seat.last_received_at).toISOString()) : "—" },
              ]} />
            </Pane>
          );
        })}
      </div>
    </main>
  );
}
