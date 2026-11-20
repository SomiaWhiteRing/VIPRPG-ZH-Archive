import { useLoaderData, useLocation, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAdministratorPage } from "@/app/.server/auth/authorize";
import { getAdminNetplayMatch, getNetplayRecordingSummary } from "@/app/.server/db/admin-netplay-matches";
import { runtimeContext } from "@/app/.server/router-context";
import { buttonVariants } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { formatDuration, formatExactTimestamp } from "@/lib/format";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate, type MessageKey } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { MATCHES_PATH, endReasonLabel } from "./labels";

const ROUTES: Readonly<Record<string, MessageKey>> = {
  direct: "admin.netplay.route.direct", websocket: "admin.netplay.route.websocket",
  hong_kong_websocket: "admin.netplay.route.hong_kong_websocket", hong_kong_turn_udp: "admin.netplay.route.hong_kong_turn_udp",
  finish_websocket: "admin.netplay.route.finish_websocket", finish_webrtc: "admin.netplay.route.finish_webrtc",
};

export async function loader({ context, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const id = params.matchId!;
  await requireAdministratorPage(runtime, `${MATCHES_PATH}/${id}`);
  const match = await getAdminNetplayMatch(runtime, id);
  if (!match) throw new Response(null, { status: 404 });
  const seats = await Promise.all(match.seats.map(async seat => ({
    ...seat, summary: await getNetplayRecordingSummary(runtime, id, seat.seat),
  })));
  return { ...match, seats, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.netplay.detail"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function AdminNetplayMatchDetail() {
  const t = useMessages();
  const match = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const routeLabel = (path: string) => Object.hasOwn(ROUTES, path) ? t(ROUTES[path]) : path === "webrtc" ? "WebRTC" : path === "turn" ? "UDP TURN" : path;
  const primary = match.room.route;
  const backup = match.room.backup;
  return (
    <main>
      <PageHeader compact title={t("admin.netplay.roomMatch", { id: match.room.roomId })} subtitle={match.id} actions={
        <Link className={buttonVariants({ variant: "outline" })} to={MATCHES_PATH + search}>{t("admin.netplay.backMatches")}</Link>
      } />
      <Pane>
        <StatList columns={3} items={[
          { label: t("admin.netplay.started"), value: formatExactTimestamp(new Date(match.startedAt).toISOString()) },
          { label: t("admin.netplay.primary"), value: primary ? routeLabel(primary) : "—" },
          { label: t("admin.netplay.backup"), value: backup ? routeLabel(backup) : "—" },
        ]} />
      </Pane>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        {match.seats.map(seat => {
          const { summary } = seat;
          const expected = (seat.last_sequence ?? -1) + 1;
          const upload = t(!seat.chunks ? "admin.netplay.notUploaded" : !seat.end_reason ? "admin.netplay.partUploaded" : "admin.netplay.uploaded");
          const missing = expected - seat.chunks + summary.missingFiles;
          return (
            <Pane key={seat.seat} heading={t("admin.netplay.seat", { seat: seat.seat })} headingAction={seat.chunks ? (
              <a className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/api/admin/netplay-matches/${match.id}/recordings/${seat.seat}`}>
                {t("admin.netplay.recording")}
              </a>
            ) : undefined}>
              <StatList items={[
                { label: t("admin.netplay.account"), value: seat.user_id ? (
                  <Link className="text-primary hover:underline" to={`/admin/users?q=${seat.user_id}`}>
                    {seat.current_name ?? seat.display_name} #{seat.user_id}
                  </Link>
                ) : seat.display_name },
                { label: t("admin.audit.target.work"), value: seat.work_id ? `#${seat.work_id}` : "—" },
                { label: t("admin.netplay.reason"), value: endReasonLabel(seat.end_reason, t) },
                { label: t("admin.netplay.score"), value: seat.score ? `${seat.score[1]} : ${seat.score[2]}` : "—" },
                { label: t("admin.netplay.finishFrame"), value: seat.score?.[0] ?? "—" },
                { label: t("admin.netplay.inputRoutes"), value: summary.routes.map(routeLabel).join(" / ") || "—" },
                { label: t("admin.netplay.waits"), value: summary.waits
                  ? t("admin.netplay.waitStats", {
                    count: summary.waits,
                    longest: formatDuration(summary.longestWaitMs, { precision: 3 }),
                    total: formatDuration(summary.totalWaitMs, { precision: 3 }),
                  })
                  : seat.chunks ? t("admin.netplay.noWaits") : "—" },
                { label: t("admin.netplay.upload"), value: [
                  upload,
                  expected ? t("admin.netplay.chunks", { received: seat.chunks, expected }) : null,
                  missing ? t("admin.netplay.missingChunks", { count: missing }) : null,
                ].filter(Boolean).join(", ") },
                { label: t("admin.netplay.lastUpload"), value: seat.last_received_at ? formatExactTimestamp(new Date(seat.last_received_at).toISOString()) : "—" },
              ]} />
            </Pane>
          );
        })}
      </div>
    </main>
  );
}
