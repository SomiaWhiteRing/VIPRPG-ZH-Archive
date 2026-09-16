import { useCallback, useEffect, useRef } from "react";
import type { NavigateOptions, To } from "react-router";
import { useBlocker, useNavigate } from "react-router";

/** Guards router transitions; document unloads retain the browser's native confirmation. */
export function useNavigationGuard(
  enabled: boolean,
  confirm: () => boolean | Promise<boolean>,
) {
  const current = useRef({ enabled, confirm });
  current.current = { enabled, confirm };
  const handling = useRef(false);
  const accepted = useRef(false);
  const navigate = useNavigate();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !accepted.current &&
      current.current.enabled &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );

  useEffect(() => {
    if (blocker.state !== "blocked" || handling.current) return;
    handling.current = true;
    void Promise.resolve()
      .then(() => current.current.confirm())
      .then(
        (leave) => {
          if (leave) blocker.proceed();
          else blocker.reset();
        },
        () => blocker.reset(),
      )
      .finally(() => {
        handling.current = false;
      });
  }, [blocker]);

  useEffect(() => {
    if (!enabled) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enabled]);

  // Use only after the caller has saved or explicitly confirmed its local change.
  return useCallback(
    async (to: To, options?: NavigateOptions) => {
      accepted.current = true;
      try {
        await navigate(to, options);
      } finally {
        accepted.current = false;
      }
    },
    [navigate],
  );
}
