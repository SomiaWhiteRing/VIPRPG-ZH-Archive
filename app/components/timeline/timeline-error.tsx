import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";
import { isRouteErrorResponse, useLocation, useRevalidator, useRouteError } from "react-router";
import { Button } from "@/app/components/ui/button";

export function TimelineError() {
  const t = useMessages();
  const error = useRouteError();
  const revalidator = useRevalidator();
  const location = useLocation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  const invalidView = isRouteErrorResponse(error) && error.status === 400 &&
    error.data?.messageKey === "timeline.error.followType";
  return <section className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-6" aria-label={t("timeline.ui.errorRegion")}>
    <h2 className="m-0 text-xl font-semibold">{missing ? t("core.notFound.title") : t("timeline.ui.errorTitle")}</h2>
    <p className="m-0 text-sm text-muted" role="alert">
      {t(missing ? "timeline.ui.missing" : invalidView ? "timeline.error.followType" : "timeline.ui.retryHint")}
    </p>
    <div className="flex flex-wrap gap-3">
      {!missing && !invalidView && <Button type="button" disabled={revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()}>{revalidator.state !== "idle" ? t("timeline.ui.retrying") : t("core.action.retry")}</Button>}
      <Button asChild variant="outline">
        <Link to={missing ? "/timeline" : location.pathname}>
          {t(invalidView ? "friends.title" : !missing && location.pathname === "/me/timeline" ? "timeline.ui.settings" : "timeline.ui.latest")}
        </Link>
      </Button>
    </div>
  </section>;
}
