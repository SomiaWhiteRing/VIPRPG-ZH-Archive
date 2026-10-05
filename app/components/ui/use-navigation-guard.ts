import { useCallback, useEffect, useRef } from "react";
import { type BlockerFunction, type NavigateOptions, type To, useBlocker, useNavigate } from "react-router";


/** Guards router transitions; document unloads retain the browser's native confirmation. */
export function useNavigationGuard(
  enabled: boolean,
  confirm: () => boolean | Promise<boolean>,
) {
  const navigate = useRouterNavigationGuard(
    ({ currentLocation, nextLocation }) => enabled &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
    confirm,
  );
  useDocumentNavigationGuard(enabled);
  return navigate;
}

// Embedded pages can own their document guard while the parent guards router transitions.
export function useRouterNavigationGuard(shouldBlock: BlockerFunction, confirm: () => boolean | Promise<boolean>) {
  const current = useRef({ shouldBlock, confirm });
  current.current = { shouldBlock, confirm };
  const handling = useRef(false);
  const accepted = useRef(false);
  const navigate = useNavigate();
  const blocker = useBlocker(
    (transition) => !accepted.current && current.current.shouldBlock(transition),
  );
  const pendingBlocker = useRef(blocker);
  pendingBlocker.current = blocker;

  useEffect(() => {
    if (blocker.state !== "blocked" || handling.current) return;
    handling.current = true;
    let active = true;
    void Promise.resolve()
      .then(() => current.current.confirm())
      .then(
        (leave) => {
          const latest = pendingBlocker.current;
          if (!active || latest.state !== "blocked") return;
          if (leave) latest.proceed();
          else latest.reset();
        },
        () => {
          const latest = pendingBlocker.current;
          if (active && latest.state === "blocked") latest.reset();
        },
      )
      .finally(() => {
        if (active) handling.current = false;
      });
    return () => { active = false; handling.current = false; };
    // Repeated navigation changes the target while the same confirmation or
    // asynchronous cleanup is pending. Resolve it once against the latest target.
  }, [blocker.state]);

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

export function useDocumentNavigationGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enabled]);
}
