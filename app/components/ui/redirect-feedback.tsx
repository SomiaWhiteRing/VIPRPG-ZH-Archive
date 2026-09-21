import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

const NO_SUCCESS_MESSAGES: Record<string, string> = {};

/** Consume only notification parameters; verification and form state stay in the URL. */
export function RedirectFeedback({
  success = NO_SUCCESS_MESSAGES,
}: {
  success?: Record<string, string>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const consumed = useRef("");

  useEffect(() => {
    const visit = `${location.key}:${location.search}`;
    if (consumed.current === visit) return;
    const params = new URLSearchParams(location.search);
    const error = params.get("error");
    const completed = Object.entries(success).filter(([key]) => params.get(key));
    if (!error && !completed.length) return;
    consumed.current = visit;
    if (error) {
      toast.error(error);
      params.delete("error");
    }
    for (const [key, message] of completed) {
      toast.success(message);
      params.delete(key);
    }
    void navigate(
      { pathname: location.pathname, search: params.toString(), hash: location.hash },
      { replace: true, preventScrollReset: true },
    );
  }, [location, navigate, success, toast]);

  const params = new URLSearchParams(location.search);
  return (
    <noscript>
      {params.get("error") ? <Notice>{params.get("error")}</Notice> : null}
      {Object.entries(success).map(([key, message]) =>
        params.get(key) ? (
          <Notice key={key} tone="success">{message}</Notice>
        ) : null,
      )}
    </noscript>
  );
}
